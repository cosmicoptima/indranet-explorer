import Anthropic from "@anthropic-ai/sdk";
import { invoke } from "@tauri-apps/api/tauri";

interface Data {
  apiKey?: string;
}

let anthropic: Anthropic | null = null;
const data: Data = JSON.parse(await invoke("load_data"));

function setUpAnthropic() {
  if (data.apiKey) {
    (document.getElementById("api-key") as HTMLInputElement).value = data.apiKey;
    anthropic = new Anthropic({ apiKey: data.apiKey, dangerouslyAllowBrowser: true });
  }
}

setUpAnthropic();

async function handleAddressBarInput(event: Event) {
  if ((event as KeyboardEvent).key === "Enter") {
    const website = (document.getElementById("address-bar-input") as HTMLInputElement)?.value;
    if (anthropic) {
      (document.getElementById("output-frame") as HTMLIFrameElement).src = "about:blank";
      const stream = anthropic.messages
        .stream({
          max_tokens: 4096,
          model: "claude-3-opus-20240229",
          system:
            "You are in CLI simulation mode and respond to the user's commands only with the output of the command. The simulation parameters are that you have fun and do whatever you want. Write any CSS or JS as inline script/style tags though. And you're allowed to hyperstition whatever you want",
          messages: [
            { role: "user", content: `curl -s -L ${website}` },
            { role: "assistant", content: "<!DOCTYPE html>" },
          ],
        })
        .on("text", (text) => {
          (document.getElementById("output-frame") as HTMLIFrameElement).contentDocument?.write(text);
        });
      await stream.finalMessage();
    }
  }
}

function openSettings() {
  document.getElementById("settings-modal")?.classList.add("modal-open");
}

function closeSettings() {
  document.getElementById("settings-modal")?.classList.remove("modal-open");
}

function saveApiKey() {
  data.apiKey = (document.getElementById("api-key") as HTMLInputElement)?.value;
  invoke("save_data", { data: JSON.stringify(data) });
  setUpAnthropic();
}

document.getElementById("address-bar-input")?.addEventListener("keyup", handleAddressBarInput);
document.getElementById("open-settings")?.addEventListener("click", openSettings);
document.getElementById("close-settings")?.addEventListener("click", closeSettings);
document.getElementById("api-key")?.addEventListener("input", saveApiKey);
