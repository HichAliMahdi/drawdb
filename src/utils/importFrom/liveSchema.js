import { nanoid } from "nanoid";
import { arrangeTables } from "../arrangeTables";
import { Cardinality, Constraint, defaultBlue } from "../../data/constants";

const normalizeConstraint = (value) => {
  if (!value) return Constraint.NONE;

  const normalized = value.toString().trim().toLowerCase();
  if (normalized === "cascade") return Constraint.CASCADE;
  if (normalized === "restrict") return Constraint.RESTRICT;
  if (normalized === "set null") return Constraint.SET_NULL;
  if (normalized === "set default") return Constraint.SET_DEFAULT;
  return Constraint.NONE;
};

export function fromLiveSchema(schema) {
  const tables = [];
  const relationships = [];

  const tableByName = new Map();

  for (const sourceTable of schema.tables || []) {
    const tableId = nanoid();
    const fields = (sourceTable.fields || []).map((field) => ({
      id: nanoid(),
      name: field.name,
      type: (field.type || "TEXT").toUpperCase(),
      default: field.default ?? "",
      check: "",
      primary: !!field.primary,
      unique: !!field.unique,
      notNull: !!field.notNull,
      increment: !!field.increment,
      comment: field.comment ?? "",
    }));

    const table = {
      id: tableId,
      name: sourceTable.name,
      comment: sourceTable.comment ?? "",
      color: defaultBlue,
      fields,
      indices: (sourceTable.indices || []).map((index, i) => ({
        id: i,
        name: index.name || `index_${i}`,
        unique: !!index.unique,
        fields: index.fields || [],
      })),
    };

    tables.push(table);
    tableByName.set(sourceTable.name, table);
  }

  for (const rel of schema.relationships || []) {
    const startTable = tableByName.get(rel.startTable);
    const endTable = tableByName.get(rel.endTable);
    if (!startTable || !endTable) continue;

    const startField = startTable.fields.find((field) => field.name === rel.startField);
    const endField = endTable.fields.find((field) => field.name === rel.endField);
    if (!startField || !endField) continue;

    const cardinality = rel.cardinality
      ? rel.cardinality
      : startField.unique || startField.primary
        ? Cardinality.ONE_TO_ONE
        : Cardinality.MANY_TO_ONE;

    relationships.push({
      id: nanoid(),
      name:
        rel.name ||
        `fk_${startTable.name}_${startField.name}_${endTable.name}`,
      startTableId: startTable.id,
      startFieldId: startField.id,
      endTableId: endTable.id,
      endFieldId: endField.id,
      cardinality,
      updateConstraint: normalizeConstraint(rel.onUpdate),
      deleteConstraint: normalizeConstraint(rel.onDelete),
    });
  }

  const diagram = { tables, relationships };
  arrangeTables(diagram);

  return diagram;
}
