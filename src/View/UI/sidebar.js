/**
 * PF2E REMASTERED — FOUNDRY-STYLE SIDEBAR SHELL (VIEW)
 *
 * Owns the right-hand sidebar tab presentation only: the active tab, ARIA
 * state, keyboard navigation, and keeping the Chat Log pinned to its newest
 * entry. It never reads or mutates rules state, so the headless core remains
 * fully decoupled from the browser UI.
 *
 * Markup contract:
 *   <aside data-sidebar-root>
 *     <button data-sidebar-tab="chat">...</button>
 *     <section data-sidebar-panel="chat">...</section>
 *   </aside>
 *
 * Panels use the native `hidden` attribute so the component still works when
 * CSS fails to load (for example on file://).
 */
(function (root) {
  "use strict";

  const NS = (root.PF2e = root.PF2e || {});
  NS.View = NS.View || {};

  const SIDEBAR_TABS = Object.freeze([
    { id: "chat", label: "Чат", icon: "💬" },
    { id: "combat", label: "Инициатива", icon: "⚔️" },
    { id: "actors", label: "Сущности", icon: "👥" },
    { id: "compendium", label: "Библиотека", icon: "📚" },
  ]);

  function normalizeId(value) {
    return value === undefined || value === null ? "" : String(value);
  }

  class Sidebar {
    constructor(options) {
      const opts = options || {};
      if (!opts.root) {
        throw new Error("Sidebar requires a root element.");
      }

      this.root = opts.root;
      this.onActivate =
        typeof opts.onActivate === "function" ? opts.onActivate : function () {};
      this.onTabKey =
        typeof opts.onTabKey === "function" ? opts.onTabKey : null;
      this.chatElement =
        opts.chatElement || this.root.querySelector("[data-sidebar-chat]");
      this.tabs = Array.from(this.root.querySelectorAll("[data-sidebar-tab]"));
      this.panels = Array.from(
        this.root.querySelectorAll("[data-sidebar-panel]"),
      );
      this.activeTabId = null;
      this.destroyed = false;

      if (this.tabs.length === 0) {
        throw new Error("Sidebar requires at least one [data-sidebar-tab] button.");
      }

      this.handleTabClick = this.handleTabClick.bind(this);
      this.handleTabKeyDown = this.handleTabKeyDown.bind(this);

      for (const tab of this.tabs) {
        tab.addEventListener("click", this.handleTabClick);
        tab.addEventListener("keydown", this.handleTabKeyDown);
      }

      const requested = normalizeId(opts.initialTab || "chat");
      const fallback = this.tabs[0].dataset.sidebarTab;
      this.activate(this.hasTab(requested) ? requested : fallback, {
        silent: true,
      });
    }

    hasTab(tabId) {
      const id = normalizeId(tabId);
      return this.tabs.some(function (tab) {
        return tab.dataset.sidebarTab === id;
      });
    }

    getActiveTab() {
      return this.activeTabId;
    }

    findTab(tabId) {
      const id = normalizeId(tabId);
      return (
        this.tabs.find(function (tab) {
          return tab.dataset.sidebarTab === id;
        }) || null
      );
    }

    findPanel(tabId) {
      const id = normalizeId(tabId);
      return (
        this.panels.find(function (panel) {
          return panel.dataset.sidebarPanel === id;
        }) || null
      );
    }

    /**
     * Switch tabs. Unknown ids return false and change nothing.
     *
     * @param {string} tabId
     * @param {{silent?:boolean, force?:boolean}} [options]
     * @returns {boolean}
     */
    activate(tabId, options) {
      const opts = options || {};
      const id = normalizeId(tabId);
      const target = this.findTab(id);
      if (!target) {
        return false;
      }
      if (this.activeTabId === id && opts.force !== true) {
        if (id === "chat") {
          this.scrollChatToBottom();
        }
        return true;
      }

      this.activeTabId = id;

      for (const tab of this.tabs) {
        const isActive = tab.dataset.sidebarTab === id;
        tab.classList.toggle("is-active", isActive);
        tab.setAttribute("aria-selected", isActive ? "true" : "false");
        tab.tabIndex = isActive ? 0 : -1;
      }

      for (const panel of this.panels) {
        const isActive = panel.dataset.sidebarPanel === id;
        panel.classList.toggle("is-active", isActive);
        if (isActive) {
          panel.removeAttribute("hidden");
        } else {
          panel.setAttribute("hidden", "");
        }
      }

      if (id === "chat") {
        this.scrollChatToBottom();
        // The panel may only get its final height after layout/paint.
        if (typeof root.requestAnimationFrame === "function") {
          root.requestAnimationFrame(this.scrollChatToBottom.bind(this));
        }
      }

      if (!opts.silent) {
        this.onActivate(id, target);
      }
      return true;
    }

    scrollChatToBottom() {
      if (!this.chatElement) {
        return;
      }
      this.chatElement.scrollTop = this.chatElement.scrollHeight;
    }

    handleTabClick(event) {
      const tab = event.currentTarget;
      if (!tab) {
        return;
      }
      this.activate(tab.dataset.sidebarTab);
    }

    /**
     * Roving focus: Left/Right cycle tabs, Home/End jump to the ends.
     */
    handleTabKeyDown(event) {
      const index = this.tabs.indexOf(event.currentTarget);
      if (index === -1) {
        return;
      }

      let nextIndex = null;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        nextIndex = (index + 1) % this.tabs.length;
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        nextIndex = (index - 1 + this.tabs.length) % this.tabs.length;
      } else if (event.key === "Home") {
        nextIndex = 0;
      } else if (event.key === "End") {
        nextIndex = this.tabs.length - 1;
      }

      if (nextIndex === null) {
        return;
      }

      event.preventDefault();
      const nextTab = this.tabs[nextIndex];
      this.activate(nextTab.dataset.sidebarTab);
      nextTab.focus();
      if (this.onTabKey) {
        this.onTabKey(nextTab.dataset.sidebarTab, nextTab);
      }
    }

    destroy() {
      if (this.destroyed) {
        return;
      }
      this.destroyed = true;
      for (const tab of this.tabs) {
        tab.removeEventListener("click", this.handleTabClick);
        tab.removeEventListener("keydown", this.handleTabKeyDown);
      }
      this.tabs = [];
      this.panels = [];
      this.chatElement = null;
    }
  }

  NS.View.Sidebar = Sidebar;
  NS.View.SIDEBAR_TABS = SIDEBAR_TABS;
})(typeof globalThis !== "undefined" ? globalThis : this);
