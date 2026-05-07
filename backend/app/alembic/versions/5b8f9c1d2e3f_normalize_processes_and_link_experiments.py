"""normalize processes and link experiments

Revision ID: 5b8f9c1d2e3f
Revises: 9c7054c6147b
Create Date: 2026-05-07 12:00:00.000000

"""

from __future__ import annotations

import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "5b8f9c1d2e3f"
down_revision = "9c7054c6147b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "process",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("overflow_data", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("frontend_data", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.ForeignKeyConstraint(["owner_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_process_owner_id", "process", ["owner_id"], unique=False)

    op.create_table(
        "processstep",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("process_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("level", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("step_category", sa.String(length=50), nullable=True),
        sa.Column("color", sa.String(length=50), nullable=True),
        sa.Column("material_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("solution_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("parameters", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("overflow_data", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("frontend_data", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.ForeignKeyConstraint(["process_id"], ["process.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["material_id"], ["material.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["solution_id"], ["solution.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_processstep_process_id", "processstep", ["process_id"], unique=False)

    op.add_column("experiment", sa.Column("process_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_experiment_process_id",
        "experiment",
        "process",
        ["process_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_experiment_process_id", "experiment", ["process_id"], unique=False)

    op.add_column(
        "experiment",
        sa.Column("overflow_data", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        "experimentresults",
        sa.Column("overflow_data", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        "substrate",
        sa.Column("overflow_data", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )

    conn = op.get_bind()

    experiments = conn.execute(
        sa.text(
            """
            SELECT id, owner_id, name, description, created_at, frontend_data
            FROM experiment
            """
        )
    ).mappings().all()

    for exp in experiments:
        process_id = uuid.uuid4()
        process_name = (exp["name"] or "")
        if process_name:
            process_name = f"{process_name} Process"
        else:
            process_name = "Process"

        conn.execute(
            sa.text(
                """
                INSERT INTO process (id, owner_id, name, description, created_at, frontend_data, overflow_data)
                VALUES (:id, :owner_id, :name, :description, :created_at, :frontend_data, :overflow_data)
                """
            ),
            {
                "id": process_id,
                "owner_id": exp["owner_id"],
                "name": process_name,
                "description": exp["description"],
                "created_at": exp["created_at"],
                "frontend_data": None,
                "overflow_data": None,
            },
        )

        conn.execute(
            sa.text("UPDATE experiment SET process_id = :pid WHERE id = :eid"),
            {"pid": process_id, "eid": exp["id"]},
        )

        layers = conn.execute(
            sa.text(
                """
                SELECT id, name, layer_type, material_id, solution_id, temperature,
                       temperature_unit, duration, duration_unit, notes
                FROM experimentlayer
                WHERE experiment_id = :eid
                ORDER BY id
                """
            ),
            {"eid": exp["id"]},
        ).mappings().all()

        for level, layer in enumerate(layers):
            params = {}
            if layer["temperature"] is not None:
                params["temperature"] = {
                    "value": str(layer["temperature"]),
                    "unit": layer["temperature_unit"] or "\u00b0C",
                }
            if layer["duration"] is not None:
                params["duration"] = {
                    "value": str(layer["duration"]),
                    "unit": layer["duration_unit"] or "min",
                }

            conn.execute(
                sa.text(
                    """
                    INSERT INTO processstep (
                        id, process_id, name, level, step_category, color,
                        material_id, solution_id, notes, parameters,
                        overflow_data, frontend_data
                    ) VALUES (
                        :id, :process_id, :name, :level, :step_category, :color,
                        :material_id, :solution_id, :notes, :parameters,
                        :overflow_data, :frontend_data
                    )
                    """
                ),
                {
                    "id": uuid.uuid4(),
                    "process_id": process_id,
                    "name": layer["name"] or f"Step {level + 1}",
                    "level": level,
                    "step_category": layer["layer_type"] or "wet_deposition",
                    "color": None,
                    "material_id": layer["material_id"],
                    "solution_id": layer["solution_id"],
                    "notes": layer["notes"],
                    "parameters": params or None,
                    "overflow_data": {"source_layer_id": str(layer["id"])},
                    "frontend_data": None,
                },
            )

    op.drop_table("experimentlayer")


def downgrade() -> None:
    op.create_table(
        "experimentlayer",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("experiment_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("layer_type", sa.String(length=50), nullable=True),
        sa.Column("material_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("solution_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("temperature", sa.Float(), nullable=True),
        sa.Column("temperature_unit", sa.String(length=50), nullable=True),
        sa.Column("duration", sa.Float(), nullable=True),
        sa.Column("duration_unit", sa.String(length=50), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["experiment_id"], ["experiment.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["material_id"], ["material.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["solution_id"], ["solution.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )

    conn = op.get_bind()
    experiments = conn.execute(
        sa.text("SELECT id, process_id FROM experiment WHERE process_id IS NOT NULL")
    ).mappings().all()

    for exp in experiments:
        steps = conn.execute(
            sa.text(
                """
                SELECT id, name, step_category, material_id, solution_id, notes, parameters
                FROM processstep
                WHERE process_id = :pid
                ORDER BY level, id
                """
            ),
            {"pid": exp["process_id"]},
        ).mappings().all()

        for step in steps:
            params = step["parameters"] or {}
            temp = params.get("temperature") if isinstance(params, dict) else None
            dur = params.get("duration") if isinstance(params, dict) else None
            conn.execute(
                sa.text(
                    """
                    INSERT INTO experimentlayer (
                        id, experiment_id, name, layer_type, material_id, solution_id,
                        temperature, temperature_unit, duration, duration_unit, notes
                    ) VALUES (
                        :id, :experiment_id, :name, :layer_type, :material_id, :solution_id,
                        :temperature, :temperature_unit, :duration, :duration_unit, :notes
                    )
                    """
                ),
                {
                    "id": uuid.uuid4(),
                    "experiment_id": exp["id"],
                    "name": step["name"],
                    "layer_type": step["step_category"],
                    "material_id": step["material_id"],
                    "solution_id": step["solution_id"],
                    "temperature": float(temp.get("value")) if isinstance(temp, dict) and temp.get("value") else None,
                    "temperature_unit": temp.get("unit") if isinstance(temp, dict) else None,
                    "duration": float(dur.get("value")) if isinstance(dur, dict) and dur.get("value") else None,
                    "duration_unit": dur.get("unit") if isinstance(dur, dict) else None,
                    "notes": step["notes"],
                },
            )

    op.drop_column("substrate", "overflow_data")
    op.drop_column("experimentresults", "overflow_data")
    op.drop_column("experiment", "overflow_data")

    op.drop_index("ix_experiment_process_id", table_name="experiment")
    op.drop_constraint("fk_experiment_process_id", "experiment", type_="foreignkey")
    op.drop_column("experiment", "process_id")

    op.drop_index("ix_processstep_process_id", table_name="processstep")
    op.drop_table("processstep")

    op.drop_index("ix_process_owner_id", table_name="process")
    op.drop_table("process")
