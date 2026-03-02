/* eslint-env node */

import cors from "cors";
import express from "express";
import mysql from "mysql2/promise";
import { Client } from "pg";
import { MongoClient } from "mongodb";

const app = express();
const PORT = process.env.DB_INTROSPECT_PORT || 8787;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const normalizeEngine = (engine) => {
  if (!engine) return "";
  const normalized = engine.toLowerCase();
  if (normalized === "postgres") return "postgresql";
  return normalized;
};

const toTitleCase = (text) => {
  if (!text) return "No action";
  return text
    .toString()
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

const buildMongoUri = ({ connectionString, host, port, username, password }) => {
  if (connectionString) return connectionString;

  const safeHost = host || "127.0.0.1";
  const safePort = port || "27017";

  if (!username) {
    return `mongodb://${safeHost}:${safePort}`;
  }

  const encodedUser = encodeURIComponent(username);
  const encodedPassword = encodeURIComponent(password || "");
  return `mongodb://${encodedUser}:${encodedPassword}@${safeHost}:${safePort}`;
};

async function listMySQLDatabases(payload) {
  const connection = await mysql.createConnection({
    host: payload.host,
    port: Number(payload.port || 3306),
    user: payload.username,
    password: payload.password,
    ssl: payload.ssl ? {} : undefined,
  });

  try {
    const [rows] = await connection.query("SHOW DATABASES");
    return rows
      .map((row) => row.Database)
      .filter((name) => !["information_schema", "mysql", "performance_schema", "sys"].includes(name));
  } finally {
    await connection.end();
  }
}

async function inspectMySQLDatabase(payload) {
  const connection = await mysql.createConnection({
    host: payload.host,
    port: Number(payload.port || 3306),
    user: payload.username,
    password: payload.password,
    database: payload.database,
    ssl: payload.ssl ? {} : undefined,
  });

  try {
    const [columns] = await connection.query(
      `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY,
              COLUMN_DEFAULT, EXTRA, COLUMN_COMMENT
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ?
       ORDER BY TABLE_NAME, ORDINAL_POSITION`,
      [payload.database],
    );

    const [indicesRaw] = await connection.query(
      `SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, COLUMN_NAME, SEQ_IN_INDEX
       FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = ?
       ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
      [payload.database],
    );

    const [foreignKeys] = await connection.query(
      `SELECT KCU.TABLE_NAME,
              KCU.COLUMN_NAME,
              KCU.REFERENCED_TABLE_NAME,
              KCU.REFERENCED_COLUMN_NAME,
              KCU.CONSTRAINT_NAME,
              RC.UPDATE_RULE,
              RC.DELETE_RULE
       FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE KCU
       LEFT JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS RC
         ON KCU.CONSTRAINT_SCHEMA = RC.CONSTRAINT_SCHEMA
        AND KCU.CONSTRAINT_NAME = RC.CONSTRAINT_NAME
       WHERE KCU.TABLE_SCHEMA = ?
         AND KCU.REFERENCED_TABLE_NAME IS NOT NULL`,
      [payload.database],
    );

    const tablesMap = new Map();

    for (const column of columns) {
      if (!tablesMap.has(column.TABLE_NAME)) {
        tablesMap.set(column.TABLE_NAME, {
          name: column.TABLE_NAME,
          comment: "",
          fields: [],
          indices: [],
        });
      }

      tablesMap.get(column.TABLE_NAME).fields.push({
        name: column.COLUMN_NAME,
        type: (column.DATA_TYPE || column.COLUMN_TYPE || "TEXT").toUpperCase(),
        default: column.COLUMN_DEFAULT ?? "",
        primary: column.COLUMN_KEY === "PRI",
        unique: column.COLUMN_KEY === "PRI" || column.COLUMN_KEY === "UNI",
        notNull: column.IS_NULLABLE === "NO",
        increment: (column.EXTRA || "").toLowerCase().includes("auto_increment"),
        comment: column.COLUMN_COMMENT || "",
      });
    }

    const indexBuckets = new Map();
    for (const indexRow of indicesRaw) {
      if (indexRow.INDEX_NAME === "PRIMARY") continue;

      const key = `${indexRow.TABLE_NAME}::${indexRow.INDEX_NAME}`;
      if (!indexBuckets.has(key)) {
        indexBuckets.set(key, {
          tableName: indexRow.TABLE_NAME,
          name: indexRow.INDEX_NAME,
          unique: indexRow.NON_UNIQUE === 0,
          fields: [],
        });
      }

      indexBuckets.get(key).fields.push(indexRow.COLUMN_NAME);
    }

    for (const idx of indexBuckets.values()) {
      const table = tablesMap.get(idx.tableName);
      if (!table) continue;
      table.indices.push({
        name: idx.name,
        unique: idx.unique,
        fields: idx.fields,
      });
    }

    const relationships = foreignKeys.map((fk) => ({
      name: fk.CONSTRAINT_NAME || `fk_${fk.TABLE_NAME}_${fk.COLUMN_NAME}_${fk.REFERENCED_TABLE_NAME}`,
      startTable: fk.TABLE_NAME,
      startField: fk.COLUMN_NAME,
      endTable: fk.REFERENCED_TABLE_NAME,
      endField: fk.REFERENCED_COLUMN_NAME,
      onUpdate: toTitleCase(fk.UPDATE_RULE),
      onDelete: toTitleCase(fk.DELETE_RULE),
    }));

    return {
      tables: Array.from(tablesMap.values()),
      relationships,
      warnings: [],
    };
  } finally {
    await connection.end();
  }
}

async function listPostgresDatabases(payload) {
  const client = new Client({
    host: payload.host,
    port: Number(payload.port || 5432),
    user: payload.username,
    password: payload.password,
    database: payload.defaultDatabase || "postgres",
    ssl: payload.ssl ? { rejectUnauthorized: false } : false,
  });

  await client.connect();
  try {
    const result = await client.query(
      `SELECT datname
       FROM pg_database
       WHERE datistemplate = false
         AND datallowconn = true
       ORDER BY datname`,
    );

    return result.rows.map((row) => row.datname);
  } finally {
    await client.end();
  }
}

async function inspectPostgresDatabase(payload) {
  const client = new Client({
    host: payload.host,
    port: Number(payload.port || 5432),
    user: payload.username,
    password: payload.password,
    database: payload.database,
    ssl: payload.ssl ? { rejectUnauthorized: false } : false,
  });

  await client.connect();
  try {
    const columnsResult = await client.query(
      `SELECT c.table_schema,
              c.table_name,
              c.column_name,
              c.data_type,
              c.udt_name,
              c.is_nullable,
              c.column_default
       FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema = c.table_schema
        AND t.table_name = c.table_name
      WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema')
        AND t.table_type = 'BASE TABLE'
      ORDER BY c.table_schema, c.table_name, c.ordinal_position`,
    );

    const uniqueResult = await client.query(
      `SELECT tc.table_schema,
              tc.table_name,
              kcu.column_name,
              tc.constraint_type
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.table_schema NOT IN ('pg_catalog', 'information_schema')
        AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')`,
    );

    const foreignResult = await client.query(
      `SELECT tc.constraint_name,
              tc.table_schema,
              tc.table_name,
              kcu.column_name,
              ccu.table_schema AS foreign_table_schema,
              ccu.table_name AS foreign_table_name,
              ccu.column_name AS foreign_column_name,
              rc.update_rule,
              rc.delete_rule
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
       JOIN information_schema.referential_constraints rc
         ON rc.constraint_name = tc.constraint_name
        AND rc.constraint_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'`,
    );

    const tablesMap = new Map();
    const uniqueMap = new Map();

    for (const row of uniqueResult.rows) {
      const tableKey = `${row.table_schema}.${row.table_name}.${row.column_name}`;
      if (!uniqueMap.has(tableKey)) {
        uniqueMap.set(tableKey, { primary: false, unique: false });
      }

      const state = uniqueMap.get(tableKey);
      if (row.constraint_type === "PRIMARY KEY") {
        state.primary = true;
        state.unique = true;
      } else if (row.constraint_type === "UNIQUE") {
        state.unique = true;
      }
    }

    const getTableName = (schema, table) => (schema === "public" ? table : `${schema}.${table}`);

    for (const row of columnsResult.rows) {
      const tableName = getTableName(row.table_schema, row.table_name);
      if (!tablesMap.has(tableName)) {
        tablesMap.set(tableName, {
          name: tableName,
          comment: "",
          fields: [],
          indices: [],
        });
      }

      const uniqueState = uniqueMap.get(
        `${row.table_schema}.${row.table_name}.${row.column_name}`,
      ) || { primary: false, unique: false };

      const rawType = row.udt_name && row.udt_name !== row.data_type ? row.udt_name : row.data_type;
      tablesMap.get(tableName).fields.push({
        name: row.column_name,
        type: (rawType || "TEXT").toUpperCase(),
        default: row.column_default || "",
        primary: uniqueState.primary,
        unique: uniqueState.unique,
        notNull: row.is_nullable === "NO",
        increment: (row.column_default || "").includes("nextval("),
        comment: "",
      });
    }

    const relationships = foreignResult.rows.map((row) => ({
      name: row.constraint_name,
      startTable: getTableName(row.table_schema, row.table_name),
      startField: row.column_name,
      endTable: getTableName(row.foreign_table_schema, row.foreign_table_name),
      endField: row.foreign_column_name,
      onUpdate: toTitleCase(row.update_rule),
      onDelete: toTitleCase(row.delete_rule),
    }));

    return {
      tables: Array.from(tablesMap.values()),
      relationships,
      warnings: [],
    };
  } finally {
    await client.end();
  }
}

function inferMongoType(value) {
  if (value === null || value === undefined) return "NULL";
  if (Array.isArray(value)) return "ARRAY";
  if (value instanceof Date) return "DATE";
  if (typeof value === "string") return "TEXT";
  if (typeof value === "number") return Number.isInteger(value) ? "INTEGER" : "DECIMAL";
  if (typeof value === "boolean") return "BOOLEAN";
  if (typeof value === "object") {
    if (value?._bsontype === "ObjectId") return "OBJECT_ID";
    return "JSON";
  }
  return "TEXT";
}

async function listMongoDatabases(payload) {
  const uri = buildMongoUri(payload);
  const client = new MongoClient(uri);

  await client.connect();
  try {
    const admin = client.db().admin();
    const result = await admin.listDatabases();
    return (result.databases || [])
      .map((db) => db.name)
      .filter((name) => !["admin", "local", "config"].includes(name));
  } finally {
    await client.close();
  }
}

async function inspectMongoDatabase(payload) {
  const uri = buildMongoUri(payload);
  const sampleLimit = Number(payload.sampleLimit || 100);
  const client = new MongoClient(uri);

  await client.connect();
  try {
    const db = client.db(payload.database);
    const collections = await db.listCollections({}, { nameOnly: true }).toArray();

    const tables = [];
    const warnings = [];

    for (const collection of collections) {
      const docs = await db
        .collection(collection.name)
        .find({})
        .limit(sampleLimit)
        .toArray();

      const fieldMap = new Map();
      fieldMap.set("_id", {
        name: "_id",
        type: "OBJECT_ID",
        default: "",
        primary: true,
        unique: true,
        notNull: true,
        increment: false,
        comment: "",
      });

      for (const doc of docs) {
        for (const [key, value] of Object.entries(doc)) {
          if (!fieldMap.has(key)) {
            fieldMap.set(key, {
              name: key,
              type: inferMongoType(value),
              default: "",
              primary: key === "_id",
              unique: key === "_id",
              notNull: key === "_id",
              increment: false,
              comment: "",
            });
          }
        }
      }

      if (docs.length === 0) {
        warnings.push(
          `Collection '${collection.name}' is empty. Only '_id' was inferred in the generated table.`,
        );
      }

      tables.push({
        name: collection.name,
        comment: "",
        fields: Array.from(fieldMap.values()),
        indices: [],
      });
    }

    return {
      tables,
      relationships: [],
      warnings,
    };
  } finally {
    await client.close();
  }
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/databases", async (req, res) => {
  const engine = normalizeEngine(req.body.engine);
  try {
    let databases = [];

    if (engine === "mysql") {
      databases = await listMySQLDatabases(req.body);
    } else if (engine === "postgresql") {
      databases = await listPostgresDatabases(req.body);
    } else if (engine === "mongodb") {
      databases = await listMongoDatabases(req.body);
    } else {
      res.status(400).json({ error: "Unsupported engine." });
      return;
    }

    res.json({ databases });
  } catch (error) {
    res.status(400).json({ error: error.message || "Unable to load databases." });
  }
});

app.post("/schema", async (req, res) => {
  const engine = normalizeEngine(req.body.engine);
  const { database } = req.body;

  if (!database) {
    res.status(400).json({ error: "Database is required." });
    return;
  }

  try {
    let schema;
    if (engine === "mysql") {
      schema = await inspectMySQLDatabase(req.body);
    } else if (engine === "postgresql") {
      schema = await inspectPostgresDatabase(req.body);
    } else if (engine === "mongodb") {
      schema = await inspectMongoDatabase(req.body);
    } else {
      res.status(400).json({ error: "Unsupported engine." });
      return;
    }

    res.json({ schema });
  } catch (error) {
    res.status(400).json({ error: error.message || "Unable to inspect database." });
  }
});

app.listen(PORT, () => {
  console.log(`DB introspection server running on http://localhost:${PORT}`);
});