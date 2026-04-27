import { Workspace } from "../components/Workspace";
import { getServerEnv } from "../lib/serverEnv";
import { getServerOpenAiKey } from "../lib/serverOpenAiKey";

export default function Page() {
  return (
    <Workspace
      hasServerOpenAiKey={Boolean(getServerOpenAiKey())}
      hasServerMockMode={getServerEnv("MOCK_MODEL") === "true"}
    />
  );
}
