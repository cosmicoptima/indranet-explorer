import Anthropic from "@anthropic-ai/sdk";
import * as cheerio from "cheerio";
import type { Component } from "solid-js";
import { createSignal, onCleanup, onMount, For } from "solid-js";
import { createStore, produce, unwrap } from "solid-js/store";
import { invoke } from "@tauri-apps/api/tauri";
import { nanoid } from "nanoid";

import "./styles.css";

let anthropic: Anthropic | null = null;
let currentRequestId = 0;

interface Node {
  id: string;
  url: string;
  content: string | null;
  parentId: string | null;
  lastVisited: number | null;
}

interface Data {
  apiKey: string;
  nodes: Node[];
  currentNodeId: string | null;
}

const DEFAULT_DATA: Data = {
  apiKey: "",
  nodes: [],
  currentNodeId: null,
};

const [data, setData] = createStore(JSON.parse(await invoke("load_data")));
for (const key in DEFAULT_DATA) {
  if (!(key in data)) {
    setData(key, DEFAULT_DATA[key as keyof Data]);
  }
}

if (data.apiKey) {
  anthropic = new Anthropic({ apiKey: data.apiKey, dangerouslyAllowBrowser: true });
}

function saveData() {
  invoke("save_data", { data: JSON.stringify(unwrap(data)) });
}

function setDataSave(key: string, value: any) {
  setData(key, value);
  saveData();
}

function setDataSaveP(producer: any) {
  setData(producer);
  saveData();
}

function saveApiKey(event: InputEvent) {
  anthropic = new Anthropic({ apiKey: (event.target as HTMLInputElement).value, dangerouslyAllowBrowser: true });
  setDataSave("apiKey", (event.target as HTMLInputElement).value);
}

function selectNode(id: string) {
  if (id) {
    updateNode(id, "lastVisited", Date.now());
  }
  setDataSave("currentNodeId", id);
}

function createNode(url: string, parentId: string | null, select: boolean = false) {
  const node: Node = {
    id: nanoid(),
    url,
    content: null,
    parentId: parentId && getNode(parentId) ? parentId : null,
    lastVisited: select ? Date.now() : null,
  };

  setDataSaveP(produce((data: Data) => {
    data.nodes.push(node);
  }));

  if (select) {
    selectNode(node.id);
  }

  return node.id;
}

function getNode(id: string) {
  return data.nodes.find((node: Node) => node.id === id);
}

function updateNode(id: string, key: keyof Node, value: any) {
  const index = data.nodes.findIndex((node: Node) => node.id === id);
  setDataSaveP(produce((data: Data) => {
    (data.nodes[index] as any)[key] = value;
  }));
}

function deleteNode(id: string) {
  const nodeToDelete = getNode(id);
  if (!nodeToDelete) return;

  // Update currentNodeId if necessary
  if (data.currentNodeId === id) {
    const newCurrentId = nodeToDelete.parentId || data.nodes.find((n: Node) => n.id !== id)?.id || null;
    selectNode(newCurrentId);
  }

  // Recursively delete all descendants
  const deleteDescendants = (nodeId: string) => {
    const children = data.nodes.filter((n: Node) => n.parentId === nodeId);
    children.forEach((child: Node) => deleteDescendants(child.id));
    
    setDataSaveP(produce((data: Data) => {
      const index = data.nodes.findIndex(n => n.id === nodeId);
      if (index !== -1) data.nodes.splice(index, 1);
    }));
  };

  deleteDescendants(id);
}

function selectParent() {
  if (data.currentNodeId) {
    selectNode(getNode(data.currentNodeId)?.parentId);
  }
}

function selectPreviousSibling() {
  const currentNode = getNode(data.currentNodeId);
  const siblings = data.nodes.filter((n: Node) => n.parentId === currentNode?.parentId);
  const index = siblings.indexOf(currentNode);
  const previousIndex = (index - 1 + siblings.length) % siblings.length;
  selectNode(siblings[previousIndex].id);
}

function selectNextSibling() {
  const currentNode = getNode(data.currentNodeId);
  const siblings = data.nodes.filter((n: Node) => n.parentId === currentNode?.parentId);
  const index = siblings.indexOf(currentNode);
  const nextIndex = (index + 1) % siblings.length;
  selectNode(siblings[nextIndex].id);
}

function selectMostRecentChild() {
  let children = data.nodes.filter((n: Node) => n.parentId === data.currentNodeId);
  children = children.sort((a: Node, b: Node) => (b.lastVisited ?? 0) - (a.lastVisited ?? 0));
  if (children.length > 0) {
    selectNode(children[0].id);
  }
}

async function loadWebpage(url: string, parentId: string | null) {
  if (!anthropic) {
    return;
  }

  const nodeId = createNode(url, parentId, true);
  updateNode(nodeId, "content", "<!DOCTYPE html>");

  let messages = [
    { role: "user", content: `curl -s -L ${url}` },
    { role: "assistant", content: "<!DOCTYPE html>" },
  ];

  let currentNodeId = data.currentNodeId;
  while (true) {
    currentNodeId = getNode(currentNodeId)?.parentId;
    if (!getNode(currentNodeId)?.content) {
      break;
    }
    messages = [
      { role: "user", content: `curl -s -L ${getNode(currentNodeId)?.url}` },
      { role: "assistant", content: getNode(currentNodeId)?.content ?? "" },
      ...messages,
    ];
  }

  const thisRequestId = ++currentRequestId;

  const stream = anthropic.messages
    .stream({
      max_tokens: 4096,
      model: "claude-3-opus-20240229",
      system:
        "You are in CLI simulation mode and respond to the user's commands only with the output of the command. The simulation parameters are that you have fun and do whatever you want. Write any CSS or JS as inline script/style tags though. You're allowed to hyperstition whatever you want.",
      messages: messages as any[],
    })
    .on("text", (text) => {
      if (thisRequestId === currentRequestId) {
        updateNode(nodeId, "content", (getNode(nodeId)?.content ?? "") + text);
      }
    });
  await stream.finalMessage();
}

async function handleAddressBarInput(event: Event) {
  if ((event as KeyboardEvent).key === "Enter") {
    (document.getElementById("address-bar-input") as HTMLInputElement).blur();
    await loadWebpage((event.target as HTMLInputElement).value, data.currentNodeId);
  }
}

function handleMessage(event: MessageEvent) {
  console.log(event);
  const url = new URL(event.data, getNode(data.currentNodeId)?.url ?? "").href;
  loadWebpage(url, data.currentNodeId);
}

const Icon = (props: { name: string, onClick?: () => void }) => (
  <span class="material-symbols-outlined icon" onClick={props.onClick}>{props.name}</span>
);

function performXssAttack(html: string) {
  const $ = cheerio.load(html);
  $("head").prepend(`
    <script>
      document.addEventListener('click', (event) => {
        if (event.target.href) {
          event.preventDefault();
          window.parent.postMessage(event.target.getAttribute('href'), '*');
        }
      });
    </script>
  `);
  $("script").each((_, script) => {
    let content = $(script).html();
    if (content) {
      content = content.replace(/window\.location\.href\s*=\s*['"]?([^'"]+)['"]/g, "window.parent.postMessage(\"$1\", '*')");  // window.location.href
      content = content.replace(/window\.location\s*=\s*['"]?([^'"]+)['"]/g, "window.parent.postMessage(\"$1\", '*')");  // window.location
      $(script).html(content);
    }
  });
  return $.html();
}

const WebpageFrame = () => {
  const content = () => performXssAttack(getNode(data.currentNodeId)?.content ?? "");
  return <iframe id="output-frame" srcdoc={content()}></iframe>
};

const Node = (props: { node: Node }) => {
  const children = () => data.nodes.filter((node: Node) => node.parentId === props.node.id);
  const onClick = () => setDataSave("currentNodeId", props.node.id);

  return <div class="node">
      <div class={`node-content${data.currentNodeId === props.node.id ? " current-node" : ""}`} onClick={onClick}>
        <div class="node-url">{props.node.url}</div>
        <div class="node-buttons">
          <Icon name="delete" onClick={() => deleteNode(props.node.id)} />
        </div>
      </div>
      <div class="node-children">
        <div class="node-children-spacer"></div>
        <div class="node-children-content">
          <For each={children()}>
            {(child) => <Node node={child} />}
          </For>
        </div>
      </div>
    </div>
};

const Nodes = () => {
  const rootNodes = () => data.nodes.filter((node: Node) => node.parentId === null);
  const onHomeClick = () => setDataSave("currentNodeId", null);

  return (
    <div id="sidebar-tree">
      <div class="node">
        <div class={`node-content${data.currentNodeId === null ? " current-node" : ""}`} onClick={onHomeClick}>
          <div class="node-url">home</div>
        </div>
        <div class="node-children">
          <div class="node-children-spacer"></div>
          <div class="node-children-content">
            <For each={rootNodes()}>
              {(node) => <Node node={node} />}
            </For>
          </div>
        </div>
      </div>
    </div>
  );
};

const App: Component = () => {
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [sidebarOpen, setSidebarOpen] = createSignal(false);

  const currentURL = () => getNode(data.currentNodeId)?.url ?? "";

  onMount(() => {
    window.addEventListener("message", handleMessage);
  });
  onCleanup(() => {
    window.removeEventListener("message", handleMessage);
  });

  return (
    <>
      <div id="container">
        <div id="notch-area"></div>

        <div id="address-bar">
          <div id="address-bar-icons-left">
            <Icon name="arrow_back" onClick={selectParent} />
            <Icon name="arrow_upward" onClick={selectPreviousSibling} />
            <Icon name="arrow_downward" onClick={selectNextSibling} />
            <Icon name="arrow_forward" onClick={selectMostRecentChild} />
            <Icon name="refresh" onClick={() => loadWebpage(currentURL(), getNode(data.currentNodeId)?.parentId)} />
          </div>

          <input type="text" autocorrect="off" autocapitalize="off" id="address-bar-input" onKeyUp={handleAddressBarInput} value={currentURL()} />

          <div id="address-bar-icons-right">
            <Icon name="settings" onClick={() => setSettingsOpen(true)} />
            <Icon name="segment" onClick={() => setSidebarOpen(!sidebarOpen())} />
          </div>
        </div>

        <div id="main-row">
          <WebpageFrame />
          <div id="right-sidebar" class={`right-sidebar${sidebarOpen() ? " sidebar-open" : ""}`}>
            <Nodes />
          </div>
        </div>
      </div>

      <div id="settings-modal" class={`modal${settingsOpen() ? " modal-open" : ""}`}>
        <div class="modal-box">
          <div class="modal-header">
            <strong class="modal-title">settings</strong>
            <Icon name="close" onClick={() => setSettingsOpen(false)} />
          </div>

          <div class="modal-content">
            <div class="settings-row">
              <span class="settings-label">API key</span>
              <input type="text" autocorrect="off" autocapitalize="off" onInput={saveApiKey} value={data.apiKey} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default App;
