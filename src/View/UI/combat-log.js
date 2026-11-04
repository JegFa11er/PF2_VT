/**
 * PF2E REMASTERED — COMBAT LOG (VIEW)
 * Lightweight append-only log used by the battlefield sidebar.
 */
(function (root) {
  "use strict";

  const NS = (root.PF2e = root.PF2e || {});
  NS.View = NS.View || {};

  class CombatLog {
    constructor(element, options) {
      if (!element) {
        throw new Error("CombatLog requires a container element.");
      }
      this.element = element;
      this.maxEntries = options && options.maxEntries ? options.maxEntries : 250;
    }

    add(message, kind) {
      const entry = document.createElement("div");
      entry.className = "log-entry log-" + (kind || "info");

      const time = document.createElement("span");
      time.className = "log-time";
      time.textContent = CombatLog.timestamp();

      const text = document.createElement("span");
      text.className = "log-text";
      text.textContent = message;

      entry.append(time, text);
      this.element.append(entry);

      while (this.element.childElementCount > this.maxEntries) {
        this.element.firstElementChild.remove();
      }

      this.element.scrollTop = this.element.scrollHeight;
      return entry;
    }

    clear() {
      this.element.replaceChildren();
    }

    static timestamp() {
      return new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    }
  }

  NS.View.CombatLog = CombatLog;
})(typeof globalThis !== "undefined" ? globalThis : this);
