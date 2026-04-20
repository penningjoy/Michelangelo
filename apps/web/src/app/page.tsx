import { Workspace } from "../components/Workspace";
import { getServerOpenAiKey } from "../lib/serverOpenAiKey";

export default function Page() {
  return <Workspace hasServerOpenAiKey={Boolean(getServerOpenAiKey())} />;
}
