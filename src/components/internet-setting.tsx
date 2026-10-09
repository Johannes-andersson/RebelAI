import { useInternet } from "@/hooks/use-internet";
import { Toggle } from "./ui-bits";
export function InternetSetting() {
  const permission = useInternet();
  return (
    <div className="border-b border-border py-5">
      <div className="flex items-center justify-between gap-8">
        <div>
          <p className="font-medium">Allow internet access</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Look up current information. Search queries are sent to your search provider; chats stay
            on this computer.
          </p>
        </div>
        <fieldset disabled={permission.loading || permission.busy}>
          <Toggle
            label="Allow internet access"
            checked={permission.enabled}
            onChange={permission.set}
          />
        </fieldset>
      </div>
      {permission.error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {permission.error}{" "}
          <button className="link-quiet" onClick={permission.retry}>
            Retry
          </button>
        </p>
      )}
    </div>
  );
}
