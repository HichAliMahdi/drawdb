import {
  Banner,
  Button,
  Checkbox,
  Input,
  Select,
  Spin,
} from "@douyinfe/semi-ui";
import { useTranslation } from "react-i18next";
import { STATUS } from "../../../data/constants";
import { inspectDatabase, listDatabases } from "../../../api/dbIntrospect";
import { fromLiveSchema } from "../../../utils/importFrom/liveSchema";

const ENGINES = [
  { value: "mysql", label: "MySQL", defaultPort: "3306" },
  { value: "postgresql", label: "PostgreSQL", defaultPort: "5432" },
  { value: "mongodb", label: "MongoDB", defaultPort: "27017" },
];

const getFriendlyConnectionError = (message) => {
  if (!message) return "Connection failed.";

  const normalized = message.toLowerCase();
  if (!normalized.includes("access denied for user")) {
    return message;
  }

  const match = message.match(/for user '([^']+)'@'([^']+)'/i);
  if (!match) {
    return `${message}\n\nMySQL credentials can be valid but still denied if the user is not allowed from this client host.`;
  }

  const user = match[1];
  const clientHost = match[2];
  return `${message}\n\nMySQL checks both username/password and client host. Add a grant for '${user}'@'${clientHost}' (or '%' for testing).`;
};

export default function ImportLiveDatabase({
  importData,
  setImportData,
  error,
  setError,
  setDiagramData,
}) {
  const { t } = useTranslation();

  const handleLoadDatabases = async () => {
    setError({ type: STATUS.NONE, message: "" });
    setDiagramData(null);
    setImportData((prev) => ({ ...prev, loadingDatabases: true }));

    try {
      const response = await listDatabases({
        engine: importData.engine,
        host: importData.host,
        port: importData.port,
        username: importData.username,
        password: importData.password,
        connectionString: importData.connectionString,
      });

      const databases = response.databases || [];

      setImportData((prev) => ({
        ...prev,
        loadingDatabases: false,
        databases,
        selectedDatabase: databases[0] || "",
      }));

      if (databases.length === 0) {
        setError({
          type: STATUS.WARNING,
          message: t("no_database_found"),
        });
      } else {
        setError({
          type: STATUS.OK,
          message: t("database_list_loaded"),
        });
      }
    } catch (e) {
      setImportData((prev) => ({
        ...prev,
        loadingDatabases: false,
        databases: [],
        selectedDatabase: "",
      }));
      setError({
        type: STATUS.ERROR,
        message: getFriendlyConnectionError(e.response?.data?.error || e.message),
      });
    }
  };

  const handleInspect = async () => {
    if (!importData.selectedDatabase) return;

    setError({ type: STATUS.NONE, message: "" });
    setDiagramData(null);
    setImportData((prev) => ({ ...prev, loadingSchema: true }));

    try {
      const response = await inspectDatabase({
        engine: importData.engine,
        host: importData.host,
        port: importData.port,
        username: importData.username,
        password: importData.password,
        connectionString: importData.connectionString,
        database: importData.selectedDatabase,
      });

      const diagram = fromLiveSchema(response.schema || {});
      setDiagramData(diagram);

      const warnings = response.schema?.warnings || [];
      setImportData((prev) => ({
        ...prev,
        loadingSchema: false,
        warnings,
      }));

      setError({
        type: warnings.length ? STATUS.WARNING : STATUS.OK,
        message: warnings.length
          ? warnings.join("\n")
          : t("database_schema_loaded"),
      });
    } catch (e) {
      setImportData((prev) => ({ ...prev, loadingSchema: false }));
      setError({
        type: STATUS.ERROR,
        message: getFriendlyConnectionError(e.response?.data?.error || e.message),
      });
    }
  };

  const onEngineChange = (engine) => {
    const nextEngine = ENGINES.find((item) => item.value === engine);

    setDiagramData(null);
    setImportData((prev) => ({
      ...prev,
      engine,
      port: nextEngine?.defaultPort || prev.port,
      databases: [],
      selectedDatabase: "",
      warnings: [],
    }));
    setError({ type: STATUS.NONE, message: "" });
  };

  return (
    <div className="space-y-3">
      <div>
        <div className="text-sm mb-1">{t("database_engine")}</div>
        <Select
          value={importData.engine}
          optionList={ENGINES.map((engine) => ({
            label: engine.label,
            value: engine.value,
          }))}
          onChange={onEngineChange}
          style={{ width: "100%" }}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="text-sm mb-1">{t("host")}</div>
          <Input
            value={importData.host}
            onChange={(value) =>
              setImportData((prev) => ({ ...prev, host: value }))
            }
            placeholder="127.0.0.1"
          />
        </div>
        <div>
          <div className="text-sm mb-1">{t("port")}</div>
          <Input
            value={importData.port}
            onChange={(value) =>
              setImportData((prev) => ({ ...prev, port: value }))
            }
            placeholder="3306"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="text-sm mb-1">{t("username")}</div>
          <Input
            value={importData.username}
            onChange={(value) =>
              setImportData((prev) => ({ ...prev, username: value }))
            }
            placeholder="root"
          />
        </div>
        <div>
          <div className="text-sm mb-1">{t("password")}</div>
          <Input
            mode="password"
            value={importData.password}
            onChange={(value) =>
              setImportData((prev) => ({ ...prev, password: value }))
            }
          />
        </div>
      </div>

      <div>
        <div className="text-sm mb-1">{t("connection_string_optional")}</div>
        <Input
          value={importData.connectionString}
          onChange={(value) =>
            setImportData((prev) => ({ ...prev, connectionString: value }))
          }
          placeholder="mongodb://user:pass@localhost:27017"
        />
      </div>

      <div className="flex items-center gap-2">
        <Button
          onClick={handleLoadDatabases}
          loading={importData.loadingDatabases}
          disabled={importData.loadingSchema}
        >
          {t("load_databases")}
        </Button>
        <Select
          value={importData.selectedDatabase}
          optionList={importData.databases.map((db) => ({
            value: db,
            label: db,
          }))}
          onChange={(value) =>
            setImportData((prev) => ({ ...prev, selectedDatabase: value }))
          }
          style={{ flex: 1 }}
          placeholder={t("select_database")}
        />
        <Button
          type="primary"
          onClick={handleInspect}
          loading={importData.loadingSchema}
          disabled={!importData.selectedDatabase || importData.loadingDatabases}
        >
          {t("inspect_database")}
        </Button>
      </div>

      <Checkbox
        aria-label="overwrite checkbox"
        checked={importData.overwrite}
        onChange={(e) =>
          setImportData((prev) => ({ ...prev, overwrite: e.target.checked }))
        }
      >
        {t("overwrite_existing_diagram")}
      </Checkbox>

      {error.type === STATUS.ERROR ? (
        <Banner
          type="danger"
          fullMode={false}
          description={<div className="whitespace-pre-line">{error.message}</div>}
        />
      ) : error.type === STATUS.OK ? (
        <Banner
          type="info"
          fullMode={false}
          description={<div className="whitespace-pre-line">{error.message}</div>}
        />
      ) : (
        error.type === STATUS.WARNING && (
          <Banner
            type="warning"
            fullMode={false}
            description={<div className="whitespace-pre-line">{error.message}</div>}
          />
        )
      )}

      {(importData.loadingDatabases || importData.loadingSchema) && (
        <div className="text-center text-sky-600">
          <Spin size="small" />
        </div>
      )}
    </div>
  );
}
