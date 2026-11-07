/**
 * PF2E REMASTERED — FOUNDRY-STYLE CONFIRM DIALOG (VIEW)
 *
 * A small presentation-only modal used for destructive confirmations. The
 * dialog owns no game rules: it renders the title/message, resolves the
 * Да/Нет choice, and invokes the supplied callbacks. Escape and a backdrop
 * click always cancel, matching Foundry's Dialog behaviour.
 *
 * The layer is appended to <body> (not the board frame) so it can never be
 * clipped by the battlefield canvas or its overflow container.
 */
(function (root) {
  "use strict";

  const NS = (root.PF2e = root.PF2e || {});
  NS.View = NS.View || {};

  class ConfirmDialog {
    constructor(options) {
      const opts = options || {};
      this.document = opts.document || root.document;
      if (!this.document || !this.document.body) {
        throw new Error("ConfirmDialog requires a document with a body.");
      }

      this.isOpen = false;
      this.onConfirm = null;
      this.onCancel = null;
      this.previousFocus = null;
      this.handleKeyDown = this.handleKeyDown.bind(this);

      this.build();
    }

    build() {
      const layer = this.document.createElement("div");
      layer.className = "confirm-dialog-layer";
      layer.hidden = true;

      const backdrop = this.document.createElement("div");
      backdrop.className = "confirm-dialog-backdrop";
      backdrop.addEventListener(
        "click",
        function () {
          this.cancel("backdrop");
        }.bind(this),
      );

      const dialog = this.document.createElement("div");
      dialog.className = "confirm-dialog";
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      dialog.setAttribute("aria-labelledby", "confirm-dialog-title");
      dialog.setAttribute("aria-describedby", "confirm-dialog-message");

      const title = this.document.createElement("h2");
      title.className = "confirm-dialog-title";
      title.id = "confirm-dialog-title";

      const message = this.document.createElement("p");
      message.className = "confirm-dialog-message";
      message.id = "confirm-dialog-message";

      const actions = this.document.createElement("div");
      actions.className = "confirm-dialog-actions";

      const cancelButton = this.document.createElement("button");
      cancelButton.type = "button";
      cancelButton.className = "dialog-button dialog-cancel";
      cancelButton.textContent = "Нет";
      cancelButton.addEventListener(
        "click",
        function () {
          this.cancel("button");
        }.bind(this),
      );

      const confirmButton = this.document.createElement("button");
      confirmButton.type = "button";
      confirmButton.className = "dialog-button dialog-confirm";
      confirmButton.textContent = "Да";
      confirmButton.addEventListener(
        "click",
        function () {
          this.confirm();
        }.bind(this),
      );

      actions.append(cancelButton, confirmButton);
      dialog.append(title, message, actions);
      layer.append(backdrop, dialog);
      this.document.body.append(layer);

      this.layer = layer;
      this.backdrop = backdrop;
      this.dialog = dialog;
      this.titleEl = title;
      this.messageEl = message;
      this.cancelButton = cancelButton;
      this.confirmButton = confirmButton;
    }

    /**
     * Show the modal. The labels default to the Foundry-style Да / Нет pair.
     *
     * @param {{
     *   title?: string,
     *   message?: string,
     *   confirmLabel?: string,
     *   cancelLabel?: string,
     *   onConfirm?: Function,
     *   onCancel?: Function
     * }} options
     */
    open(options) {
      const opts = options || {};
      this.titleEl.textContent = opts.title || "Подтверждение";
      this.messageEl.textContent = opts.message || "";
      this.confirmButton.textContent = opts.confirmLabel || "Да";
      this.cancelButton.textContent = opts.cancelLabel || "Нет";
      this.onConfirm = typeof opts.onConfirm === "function" ? opts.onConfirm : null;
      this.onCancel = typeof opts.onCancel === "function" ? opts.onCancel : null;

      this.previousFocus = this.document.activeElement;
      this.isOpen = true;
      this.layer.hidden = false;
      this.layer.classList.add("is-open");
      this.document.body.classList.add("dialog-open");
      this.document.addEventListener("keydown", this.handleKeyDown, true);

      if (typeof root.requestAnimationFrame === "function") {
        root.requestAnimationFrame(this.focusCancel.bind(this));
      } else {
        this.focusCancel();
      }
    }

    focusCancel() {
      if (this.isOpen && typeof this.cancelButton.focus === "function") {
        this.cancelButton.focus();
      }
    }

    confirm() {
      if (!this.isOpen) {
        return false;
      }
      const callback = this.onConfirm;
      this.close(true);
      if (callback) {
        callback();
      }
      return true;
    }

    cancel(reason) {
      if (!this.isOpen) {
        return false;
      }
      const callback = this.onCancel;
      this.close(false);
      if (callback) {
        callback(reason || "cancel");
      }
      return true;
    }

    close(confirmed) {
      this.isOpen = false;
      this.layer.hidden = true;
      this.layer.classList.remove("is-open");
      this.document.body.classList.remove("dialog-open");
      this.document.removeEventListener("keydown", this.handleKeyDown, true);
      this.onConfirm = null;
      this.onCancel = null;

      const previous = this.previousFocus;
      this.previousFocus = null;
      if (previous && typeof previous.focus === "function") {
        previous.focus();
      }
      return confirmed === true;
    }

    handleKeyDown(event) {
      if (!this.isOpen) {
        return;
      }
      if (event.key === "Escape") {
        // Stop the battlefield Escape handler from also clearing selection.
        event.preventDefault();
        event.stopPropagation();
        this.cancel("escape");
      }
    }

    destroy() {
      if (this.isOpen) {
        this.close(false);
      }
      if (this.layer && this.layer.parentNode) {
        this.layer.parentNode.removeChild(this.layer);
      }
    }
  }

  NS.View.ConfirmDialog = ConfirmDialog;
})(typeof globalThis !== "undefined" ? globalThis : this);
