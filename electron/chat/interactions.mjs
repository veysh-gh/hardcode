import { randomUUID } from "node:crypto";
import { IPC_EVENTS } from "../ipc/contracts.mjs";

export function createChatInteractions({ pendingInteractions, sendChatEvent, toIpcSafe }) {
function sendInteraction(chat, interaction) {
  const id = randomUUID();
  if (!chat.sender.isDestroyed()) {
    chat.sender.send(IPC_EVENTS.chat.interaction, {
      chatId: chat.id,
      interaction: toIpcSafe({ id, ...interaction }),
    });
  }
  return id;
}

function requestInteraction(chat, interaction, signal) {
  const id = sendInteraction(chat, interaction);

  return new Promise((resolve, reject) => {
    const finish = (callback, value) => {
      pendingInteractions.delete(id);
      signal?.removeEventListener("abort", onAbort);
      if (!chat.sender.isDestroyed()) {
        chat.sender.send(IPC_EVENTS.chat.interactionClear, { chatId: chat.id, id });
      }
      callback(value);
    };
    const onAbort = () => finish(reject, new Error("Interaction cancelled"));

    if (signal?.aborted) {
      onAbort();
      return;
    }

    signal?.addEventListener("abort", onAbort, { once: true });
    pendingInteractions.set(id, {
      chatId: chat.id,
      ownerId: chat.ownerId,
      resolve: (value) => finish(resolve, value),
      reject: (error) => finish(reject, error),
    });
  });
}

function clearInteraction(chat, id) {
  if (!chat.sender.isDestroyed()) {
    chat.sender.send(IPC_EVENTS.chat.interactionClear, { chatId: chat.id, id });
  }
}

function createExtensionUI(chat) {
  const unsupportedTheme = new Proxy(
    {},
    {
      get: () => (...args) => String(args.at(-1) ?? ""),
    },
  );

  return {
    select: async (title, options, opts = {}) => {
      const response = await requestInteraction(
        chat,
        {
          type: "select",
          title,
          options: options.map((label, index) => ({ id: String(index), label })),
        },
        opts.signal,
      );
      if (response.cancelled) return undefined;
      return options[Number(response.value)];
    },
    confirm: async (title, message, opts = {}) => {
      const response = await requestInteraction(chat, { type: "confirm", title, message }, opts.signal);
      return response.cancelled ? false : Boolean(response.confirmed);
    },
    input: async (title, placeholder, opts = {}) => {
      const response = await requestInteraction(
        chat,
        { type: "input", title, placeholder, secret: false },
        opts.signal,
      );
      return response.cancelled ? undefined : response.value;
    },
    editor: async (title, prefill) => {
      const response = await requestInteraction(chat, {
        type: "input",
        title,
        value: prefill,
        multiline: true,
      });
      return response.cancelled ? undefined : response.value;
    },
    notify: (message, notifyType = "info") =>
      sendChatEvent(chat, { type: notifyType === "error" ? "error" : "status", content: message }),
    onTerminalInput: () => () => {},
    setStatus: (_key, text) => text && sendChatEvent(chat, { type: "status", content: text }),
    setWorkingMessage: () => {},
    setWorkingVisible: () => {},
    setWorkingIndicator: () => {},
    setHiddenThinkingLabel: () => {},
    setWidget: () => {},
    setTitle: () => {},
    custom: async () => undefined,
    pasteToEditor: () => {},
    setEditorText: () => {},
    getEditorText: () => "",
    addAutocompleteProvider: () => {},
    setEditorComponent: () => {},
    getEditorComponent: () => undefined,
    theme: unsupportedTheme,
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({ success: false, error: "Themes are not available in Hardcode." }),
    getToolsExpanded: () => true,
    setToolsExpanded: () => {},
  };
}

return { sendInteraction, requestInteraction, clearInteraction, createExtensionUI };
}
