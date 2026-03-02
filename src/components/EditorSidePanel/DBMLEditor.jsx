import { useEffect, useState } from "react";
import { useDiagram, useEnums, useLayout } from "../../hooks";
import { toDBML } from "../../utils/exportAs/dbml";
import { Button, Toast, Tooltip } from "@douyinfe/semi-ui";
import {
  IconLock,
  IconSaveStroked,
  IconTemplate,
  IconUnlock,
} from "@douyinfe/semi-icons";
import { useTranslation } from "react-i18next";
import CodeEditor from "../CodeEditor";
import { fromDBML } from "../../utils/importFrom/dbml";

export default function DBMLEditor() {
  const {
    tables: currentTables,
    relationships,
    setTables,
    setRelationships,
  } = useDiagram();
  const diagram = useDiagram();
  const { enums, setEnums } = useEnums();
  const [value, setValue] = useState(() => toDBML({ ...diagram, enums }));
  const [readOnly, setReadOnly] = useState(true);
  const { layout, setLayout } = useLayout();
  const { t } = useTranslation();

  const toggleDBMLEditor = () => {
    setLayout((prev) => ({ ...prev, dbmlEditor: !prev.dbmlEditor }));
  };

  const applyDBML = (closeEditMode = false) => {
    try {
      const parsed = fromDBML(value);
      setTables(parsed.tables ?? []);
      setRelationships(parsed.relationships ?? []);
      setEnums(parsed.enums ?? []);
      if (closeEditMode) {
        setReadOnly(true);
      }
    } catch (error) {
      const diag = error?.diags?.[0];
      const message = diag
        ? `${diag.name} [Ln ${diag.location.start.line}, Col ${diag.location.start.column}]: ${diag.message}`
        : t("oops_smth_went_wrong");

      Toast.error(message);
    }
  };

  const toggleReadOnly = () => {
    if (readOnly) {
      setReadOnly(false);
      return;
    }

    applyDBML(true);
  };

  useEffect(() => {
    if (!readOnly) return;
    setValue(toDBML({ tables: currentTables, enums, relationships }));
  }, [currentTables, enums, relationships, readOnly]);

  return (
    <CodeEditor
      showCopyButton
      value={value}
      language="dbml"
      onChange={setValue}
      height="100%"
      options={{
        readOnly: readOnly || layout.readOnly,
        minimap: { enabled: false },
      }}
      extraControls={
        <>
          <Tooltip content={t("confirm")}>
            <Button
              icon={<IconSaveStroked />}
              onClick={() => applyDBML(false)}
              disabled={readOnly || layout.readOnly}
            />
          </Tooltip>
          <Tooltip content={readOnly ? t("edit") : t("read_only")}>
            <Button
              icon={readOnly ? <IconLock /> : <IconUnlock />}
              onClick={toggleReadOnly}
              disabled={layout.readOnly}
            />
          </Tooltip>
          <Tooltip content={t("tab_view")}>
            <Button icon={<IconTemplate />} onClick={toggleDBMLEditor} />
          </Tooltip>
        </>
      }
    />
  );
}
