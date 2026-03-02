import axios from "axios";

const baseUrl = import.meta.env.VITE_DB_CONNECTOR_URL || "/db-introspect";

export async function listDatabases(payload) {
  const { data } = await axios.post(`${baseUrl}/databases`, payload);
  return data;
}

export async function inspectDatabase(payload) {
  const { data } = await axios.post(`${baseUrl}/schema`, payload);
  return data;
}
