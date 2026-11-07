/**
 * PF2E REMASTERED — COMPENDIUM BROWSER (VIEW)
 *
 * Renders the generated data/compendiums/*.json catalogs inside the sidebar's
 * "Библиотека" panel. The browser owns presentation and local filtering only:
 *
 *   - four category tabs (spells, weapons, shields, bestiary);
 *   - quick name search, rank/level filter, and spell save-type filter;
 *   - compact expandable cards with combat-relevant badges and stats;
 *   - action buttons that delegate to the host (src/main.js):
 *       Экипировать   -> combatant.addInventoryItem + combatant.equipItem
 *       Добавить магу -> append the normalized spell to combatant.spells
 *       Заспавнить    -> create a Combatant and register it in the Encounter
 *
 * The module never mutates rules state itself; it only calls the callbacks it
 * receives. Catalogs are fetched lazily the first time the tab is activated.
 */
(function (root) {
  "use strict";

  const NS = (root.PF2e = root.PF2e || {});
  NS.View = NS.View || {};

  const CATEGORIES = Object.freeze([
    {
      id: "spells",
      label: "Заклинания",
      icon: "🔮",
      file: "spells.json",
      empty: "Заклинания не найдены.",
    },
    {
      id: "weapons",
      label: "Оружие",
      icon: "⚔️",
      file: "weapons.json",
      empty: "Оружие не найдено.",
    },
    {
      id: "shields",
      label: "Щиты",
      icon: "🛡️",
      file: "shields.json",
      empty: "Щиты не найдены.",
    },
    {
      id: "monsters",
      label: "Бестиарий",
      icon: "👾",
      file: "monsters.json",
      empty: "Монстры не найдены.",
    },
  ]);

  const CATEGORY_BY_ID = CATEGORIES.reduce(function (map, category) {
    map[category.id] = category;
    return map;
  }, {});

  function make(doc, tag, className, text) {
    const node = doc.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text !== undefined && text !== null) {
      node.textContent = String(text);
    }
    return node;
  }

  function normalize(value) {
    return String(value === undefined || value === null ? "" : value)
      .trim()
      .toLowerCase();
  }

  function categoryOf(id) {
    return CATEGORY_BY_ID[id] || CATEGORY_BY_ID.spells;
  }

  function defaultFetchJson(url) {
    if (typeof root.fetch !== "function") {
      return Promise.reject(
        new Error("fetch() is unavailable; serve the project over HTTP."),
      );
    }
    return root
      .fetch(url, { cache: "no-cache" })
      .then(function (response) {
        if (!response.ok) {
          throw new Error("HTTP " + response.status + " for " + url);
        }
        return response.json();
      });
  }

  function actionCostLabel(cost) {
    if (!Number.isInteger(cost)) {
      return null;
    }
    return cost + (cost === 1 ? " действие" : cost < 5 ? " действия" : " действий");
  }

  function areaLabel(area) {
    if (!area || !area.type || !Number.isInteger(area.value)) {
      return null;
    }
    const names = {
      burst: "взрыв",
      cone: "конус",
      line: "линия",
      emanation: "эманация",
      cylinder: "цилиндр",
      sphere: "сфера",
      square: "квадрат",
    };
    return (names[area.type] || area.type) + " " + area.value + " фт";
  }

  function saveLabel(save) {
    if (!save || !save.statistic) {
      return null;
    }
    const names = {
      reflex: "Reflex",
      fortitude: "Fortitude",
      will: "Will",
    };
    return (names[save.statistic] || save.statistic) + (save.basic ? " (basic)" : "");
  }

  function coinsLabel(value) {
    return value === undefined || value === null ? "—" : String(value);
  }

  class CompendiumBrowser {
    constructor(options) {
      const opts = options || {};
      if (!opts.root) {
        throw new Error("CompendiumBrowser requires a root element.");
      }

      this.root = opts.root;
      this.document = opts.document || root.document || this.root.ownerDocument;
      this.dataBasePath =
        typeof opts.dataBasePath === "string" && opts.dataBasePath !== ""
          ? opts.dataBasePath
          : "data/compendiums/";
      this.fetchJson =
        typeof opts.fetchJson === "function" ? opts.fetchJson : defaultFetchJson;

      this.onEquipItem =
        typeof opts.onEquipItem === "function" ? opts.onEquipItem : function () {};
      this.onAddSpell =
        typeof opts.onAddSpell === "function" ? opts.onAddSpell : function () {};
      this.onSpawnMonster =
        typeof opts.onSpawnMonster === "function"
          ? opts.onSpawnMonster
          : function () {};
      this.onLog =
        typeof opts.onLog === "function" ? opts.onLog : function () {};
      this.onStateChanged =
        typeof opts.onStateChanged === "function"
          ? opts.onStateChanged
          : function () {};
      this.getRecipients =
        typeof opts.getRecipients === "function"
          ? opts.getRecipients
          : function () {
              return [];
            };
      this.getPreferredRecipient =
        typeof opts.getPreferredRecipient === "function"
          ? opts.getPreferredRecipient
          : function () {
              return null;
            };

      this.activeCategory = "spells";
      this.catalogs = null;
      this.loading = false;
      this.error = null;
      this.loadPromise = null;
      this.search = "";
      this.levelFilter = "";
      this.saveFilter = "";
      this.recipientId = null;
      this.expanded = new Set();
      this.draggingKey = null;
      this.destroyed = false;

      this.build();
    }

    // -------------------------------------------------------------- structure

    build() {
      const doc = this.document;
      this.root.classList.add("compendium-browser");
      this.root.replaceChildren();

      const head = make(doc, "div", "compendium-head");
      const titleBox = make(doc, "div", "compendium-title");
      titleBox.append(
        make(doc, "h2", "compendium-heading", "Библиотека"),
        make(doc, "span", "compendium-status", "Данные ещё не загружены."),
      );
      this.statusEl = titleBox.querySelector(".compendium-status");
      this.reloadButton = make(doc, "button", "compendium-reload", "⟳");
      this.reloadButton.type = "button";
      this.reloadButton.title = "Перезагрузить каталоги";
      this.reloadButton.setAttribute("aria-label", "Перезагрузить каталоги");
      this.reloadButton.addEventListener(
        "click",
        function () {
          this.load(true);
        }.bind(this),
      );
      head.append(titleBox, this.reloadButton);

      const categories = make(doc, "div", "compendium-categories");
      categories.setAttribute("role", "tablist");
      categories.setAttribute("aria-label", "Каталоги компендиума");
      this.categoryButtons = new Map();
      for (const category of CATEGORIES) {
        const button = make(
          doc,
          "button",
          "compendium-category",
          category.icon + " " + category.label,
        );
        button.type = "button";
        button.dataset.compendiumCategory = category.id;
        button.setAttribute("role", "tab");
        button.setAttribute("aria-selected", "false");
        button.addEventListener(
          "click",
          function () {
            this.setCategory(category.id);
          }.bind(this),
        );
        this.categoryButtons.set(category.id, button);
        categories.append(button);
      }

      const filters = make(doc, "div", "compendium-filters");
      this.searchInput = make(doc, "input", "compendium-search");
      this.searchInput.type = "text";
      this.searchInput.placeholder = "Поиск по названию…";
      this.searchInput.setAttribute("aria-label", "Поиск по названию");
      this.searchInput.addEventListener(
        "input",
        function () {
          this.search = this.searchInput.value;
          this.renderList();
        }.bind(this),
      );

      this.levelSelect = make(doc, "select", "compendium-filter");
      this.levelSelect.setAttribute("aria-label", "Фильтр по рангу или уровню");
      this.levelSelect.addEventListener(
        "change",
        function () {
          this.levelFilter = this.levelSelect.value;
          this.renderList();
        }.bind(this),
      );

      this.saveSelect = make(doc, "select", "compendium-filter");
      this.saveSelect.setAttribute("aria-label", "Фильтр по типу спасброска");
      this.saveSelect.addEventListener(
        "change",
        function () {
          this.saveFilter = this.saveSelect.value;
          this.renderList();
        }.bind(this),
      );

      filters.append(this.searchInput, this.levelSelect, this.saveSelect);

      const recipientRow = make(doc, "div", "compendium-recipient");
      this.recipientLabel = make(
        doc,
        "label",
        "compendium-recipient-label",
        "Получатель",
      );
      this.recipientSelect = make(doc, "select", "compendium-recipient-select");
      this.recipientSelect.addEventListener(
        "change",
        function () {
          this.recipientId = this.recipientSelect.value;
        }.bind(this),
      );
      this.recipientLabel.append(this.recipientSelect);
      recipientRow.append(this.recipientLabel);
      this.recipientRow = recipientRow;

      this.listEl = make(doc, "div", "compendium-list");
      this.listEl.setAttribute("role", "list");

      this.root.append(head, categories, filters, recipientRow, this.listEl);

      this.applyCategoryUi();
      this.renderList();
    }

    // --------------------------------------------------------------- loading

    /**
     * Called when the sidebar Compendium tab is activated. Loads the catalogs
     * once and re-renders afterwards.
     *
     * @returns {Promise<void>}
     */
    activate() {
      if (this.catalogs) {
        this.renderList();
        return Promise.resolve();
      }
      return this.load(false);
    }

    load(force) {
      if (this.destroyed) {
        return Promise.resolve();
      }
      if (this.loading) {
        return this.loadPromise;
      }
      if (this.catalogs && force !== true) {
        return Promise.resolve();
      }

      this.loading = true;
      this.error = null;
      this.renderStatus();
      this.renderList();

      const base = this.dataBasePath.replace(/\/?$/, "/");
      const requests = CATEGORIES.map(
        function (category) {
          return this.fetchJson(base + category.file).then(function (data) {
            if (!Array.isArray(data)) {
              throw new Error(category.file + " did not contain an array.");
            }
            return [category.id, data];
          });
        }.bind(this),
      );

      this.loadPromise = Promise.all(requests)
        .then(
          function (results) {
            const catalogs = {};
            for (const entry of results) {
              catalogs[entry[0]] = entry[1];
            }
            this.catalogs = catalogs;
            this.loading = false;
            this.error = null;
            this.renderStatus();
            this.syncRecipients();
            this.renderList();
          }.bind(this),
        )
        .catch(
          function (error) {
            this.loading = false;
            this.error = error && error.message ? error.message : String(error);
            this.renderStatus();
            this.renderList();
            this.onLog(
              "Compendium load failed — " + this.error,
              "warn",
            );
          }.bind(this),
        );

      return this.loadPromise;
    }

    // ------------------------------------------------------------- categories

    setCategory(categoryId) {
      const category = categoryOf(categoryId);
      if (this.activeCategory === category.id) {
        return;
      }
      this.activeCategory = category.id;
      this.levelFilter = "";
      this.saveFilter = "";
      // Each catalog defaults to the selected/active combatant again instead
      // of carrying a recipient choice over from the previous category.
      this.recipientId = null;
      this.applyCategoryUi();
      this.syncRecipients();
      this.renderList();
    }

    applyCategoryUi() {
      const category = categoryOf(this.activeCategory);

      for (const entry of this.categoryButtons) {
        const button = entry[1];
        const active = entry[0] === category.id;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-selected", active ? "true" : "false");
        button.tabIndex = active ? 0 : -1;
      }

      this.levelSelect.replaceChildren();
      if (category.id === "spells") {
        this.levelSelect.disabled = false;
        this.levelSelect.append(this.option("", "Все ранги"));
        this.levelSelect.append(this.option("0", "Кантрип"));
        for (let rank = 1; rank <= 10; rank += 1) {
          this.levelSelect.append(this.option(String(rank), "Ранг " + rank));
        }
      } else if (category.id === "monsters") {
        this.levelSelect.disabled = false;
        this.levelSelect.append(this.option("", "Все уровни"));
        for (let level = 1; level <= 10; level += 1) {
          this.levelSelect.append(this.option(String(level), "Уровень " + level));
        }
      } else {
        this.levelSelect.disabled = true;
        this.levelSelect.append(this.option("", "Без фильтра"));
      }
      this.levelSelect.value = this.levelFilter;

      this.saveSelect.replaceChildren();
      const isSpell = category.id === "spells";
      this.saveSelect.disabled = !isSpell;
      this.saveSelect.hidden = !isSpell;
      if (isSpell) {
        this.saveSelect.append(this.option("", "Все спасброски"));
        this.saveSelect.append(this.option("reflex", "Reflex"));
        this.saveSelect.append(this.option("fortitude", "Fortitude"));
        this.saveSelect.append(this.option("will", "Will"));
        this.saveSelect.value = this.saveFilter;
      }

      this.recipientRow.hidden = category.id === "monsters";
      this.searchInput.placeholder =
        "Поиск " +
        category.label.toLowerCase() +
        " по названию…";
    }

    option(value, label) {
      const option = this.document.createElement("option");
      option.value = value;
      option.textContent = label;
      return option;
    }

    syncRecipients() {
      const category = categoryOf(this.activeCategory);
      const recipients = this.getRecipients(category.id) || [];
      const previous = this.recipientId;
      this.recipientSelect.replaceChildren();

      if (recipients.length === 0) {
        this.recipientSelect.append(this.option("", "Нет получателя"));
        this.recipientSelect.disabled = true;
        this.recipientId = null;
        return;
      }

      for (const combatant of recipients) {
        const hp = Number.isInteger(combatant.currentHP)
          ? " · HP " + combatant.currentHP + "/" + combatant.maxHP
          : "";
        this.recipientSelect.append(this.option(combatant.id, combatant.name + hp));
      }
      this.recipientSelect.disabled = false;

      const preferred = this.getPreferredRecipient(category.id);
      const preferredId = preferred && preferred.id ? preferred.id : null;
      const ids = recipients.map(function (combatant) {
        return combatant.id;
      });

      if (previous && ids.indexOf(previous) !== -1) {
        this.recipientId = previous;
      } else if (preferredId && ids.indexOf(preferredId) !== -1) {
        this.recipientId = preferredId;
      } else {
        this.recipientId = ids[0];
      }
      this.recipientSelect.value = this.recipientId || "";
    }

    // --------------------------------------------------------------- filtering

    entriesFor(categoryId) {
      if (!this.catalogs || !Array.isArray(this.catalogs[categoryId])) {
        return [];
      }
      return this.catalogs[categoryId];
    }

    filteredEntries() {
      const category = categoryOf(this.activeCategory);
      const search = normalize(this.search);
      const levelFilter = this.levelFilter === "" ? null : Number(this.levelFilter);
      const saveFilter = normalize(this.saveFilter);

      return this.entriesFor(category.id).filter(
        function (entry) {
          if (search !== "" && normalize(entry.name).indexOf(search) === -1) {
            return false;
          }

          if (levelFilter !== null) {
            if (
              category.id === "spells" &&
              (entry.isCantrip ? 0 : entry.rank) !== levelFilter
            ) {
              return false;
            }
            if (category.id === "monsters" && entry.level !== levelFilter) {
              return false;
            }
          }

          if (category.id === "spells" && saveFilter !== "") {
            if (!entry.save || normalize(entry.save.statistic) !== saveFilter) {
              return false;
            }
          }

          return true;
        },
      );
    }

    // ---------------------------------------------------------------- rendering

    renderStatus() {
      const category = categoryOf(this.activeCategory);
      const total = this.entriesFor(category.id).length;

      if (this.loading) {
        this.statusEl.textContent = "Загрузка каталогов…";
        this.statusEl.dataset.state = "loading";
        this.reloadButton.disabled = true;
        return;
      }
      this.reloadButton.disabled = false;
      if (this.error) {
        this.statusEl.textContent = "Ошибка загрузки";
        this.statusEl.dataset.state = "error";
        return;
      }
      if (!this.catalogs) {
        this.statusEl.textContent = "Данные ещё не загружены.";
        this.statusEl.dataset.state = "idle";
        return;
      }
      const filtered = this.filteredEntries().length;
      this.statusEl.textContent =
        total === 0
          ? "Каталог пуст."
          : filtered + " из " + total + " · " + category.label;
      this.statusEl.dataset.state = "ready";
    }

    renderList() {
      if (!this.listEl) {
        return;
      }
      this.renderStatus();
      this.listEl.replaceChildren();

      if (this.loading) {
        this.listEl.append(
          make(this.document, "p", "compendium-empty", "Загрузка библиотеки…"),
        );
        return;
      }

      if (this.error) {
        const errorBox = make(
          this.document,
          "div",
          "compendium-error",
          "Не удалось загрузить каталоги: " + this.error,
        );
        const retry = make(this.document, "button", "compendium-action", "Повторить");
        retry.type = "button";
        retry.addEventListener(
          "click",
          function () {
            this.load(true);
          }.bind(this),
        );
        errorBox.append(retry);
        this.listEl.append(errorBox);
        return;
      }

      if (!this.catalogs) {
        this.listEl.append(
          make(
            this.document,
            "p",
            "compendium-empty",
            "Откройте вкладку «Библиотека», чтобы загрузить каталоги.",
          ),
        );
        return;
      }

      const category = categoryOf(this.activeCategory);
      const entries = this.filteredEntries();
      if (entries.length === 0) {
        this.listEl.append(
          make(this.document, "p", "compendium-empty", category.empty),
        );
        return;
      }

      for (const entry of entries) {
        this.listEl.append(this.renderCard(entry));
      }
    }

    renderCard(entry) {
      const doc = this.document;
      const category = categoryOf(this.activeCategory);
      const key = category.id + ":" + entry.id;
      const expanded = this.expanded.has(key);

      const card = make(doc, "article", "compendium-card");
      card.dataset.compendiumEntry = entry.id;
      card.dataset.compendiumCategory = category.id;
      card.setAttribute("role", "listitem");
      card.classList.toggle("is-expanded", expanded);

      // Phase 25: every catalog card is a drag source. The drop targets parse
      // the same JSON contract from dataTransfer (battlefield canvas and the
      // floating character sheet).
      card.draggable = true;
      card.addEventListener(
        "dragstart",
        function (event) {
          this.handleCardDragStart(event, entry, category.id);
        }.bind(this),
      );
      card.addEventListener(
        "dragend",
        function (event) {
          this.handleCardDragEnd(event);
        }.bind(this),
      );

      const head = make(doc, "button", "compendium-card-head");
      head.type = "button";
      head.setAttribute("aria-expanded", expanded ? "true" : "false");

      const icon = make(doc, "span", "compendium-card-icon", category.icon);
      icon.setAttribute("aria-hidden", "true");

      const main = make(doc, "span", "compendium-card-main");
      main.append(
        make(doc, "span", "compendium-card-name", entry.name),
        make(
          doc,
          "span",
          "compendium-card-sub",
          this.cardSubtitle(entry, category.id),
        ),
      );

      const badges = make(doc, "span", "compendium-card-badges");
      for (const badge of this.cardBadges(entry, category.id)) {
        badges.append(
          make(
            doc,
            "span",
            "compendium-badge" + (badge.accent ? " is-accent" : ""),
            badge.label,
          ),
        );
      }

      head.append(icon, main, badges);
      head.addEventListener(
        "click",
        function () {
          if (expanded) {
            this.expanded.delete(key);
          } else {
            this.expanded.add(key);
          }
          this.renderList();
        }.bind(this),
      );

      const body = make(doc, "div", "compendium-card-body");
      body.hidden = !expanded;
      if (expanded) {
        body.append(this.renderBody(entry, category.id));
      }

      card.append(head, body);
      return card;
    }

    /**
     * Serialize one catalog entry for both HTML5 drop targets.
     *
     * @param {DragEvent} event
     * @param {object} entry catalog record
     * @param {"spells"|"weapons"|"shields"|"monsters"} categoryId
     */
    handleCardDragStart(event, entry, categoryId) {
      const payload = {
        type: "compendium-item",
        category: categoryId,
        entry: entry,
      };
      const json = JSON.stringify(payload);
      if (event.dataTransfer) {
        try {
          event.dataTransfer.effectAllowed = "copy";
          event.dataTransfer.setData("application/json", json);
          event.dataTransfer.setData("text/plain", json);
        } catch (error) {
          // Some embedded webviews restrict custom MIME types; text/plain is
          // still written above whenever possible.
        }
      }
      const card = event.currentTarget;
      if (card && card.classList) {
        card.classList.add("is-dragging");
      }
      this.draggingKey = categoryId + ":" + entry.id;
    }

    handleCardDragEnd(event) {
      const card = event.currentTarget;
      if (card && card.classList) {
        card.classList.remove("is-dragging");
      }
      this.draggingKey = null;
    }

    cardSubtitle(entry, categoryId) {
      if (categoryId === "spells") {
        const parts = [];
        if (entry.isCantrip) {
          parts.push("Кантрип");
        } else if (Number.isInteger(entry.rank)) {
          parts.push("Ранг " + entry.rank);
        }
        const cost = actionCostLabel(entry.actionCost);
        if (cost) parts.push(cost);
        if (entry.isFocus) parts.push("Focus");
        if (entry.isSustained) parts.push("Sustained");
        return parts.join(" · ");
      }
      if (categoryId === "weapons") {
        const parts = [entry.category || "weapon"];
        parts.push(entry.hands === 2 ? "2 руки" : "1 рука");
        if (entry.rangeIncrement) parts.push("дистанция " + entry.rangeIncrement + " фт");
        if (entry.reload !== null && entry.reload !== undefined) {
          parts.push("перезарядка " + entry.reload);
        }
        return parts.join(" · ");
      }
      if (categoryId === "shields") {
        return "AC +" + entry.acBonus + " · твёрдость " + entry.hardness;
      }
      const parts = ["Уровень " + entry.level, entry.size || "medium"];
      parts.push("HP " + entry.hp);
      parts.push("AC " + entry.ac);
      return parts.join(" · ");
    }

    cardBadges(entry, categoryId) {
      const badges = [];
      if (categoryId === "spells") {
        if (entry.damage) {
          badges.push({
            label: entry.damage.formula + " " + entry.damage.type,
            accent: true,
          });
        }
        if (entry.save) {
          badges.push({ label: saveLabel(entry.save) });
        }
        if (entry.area) {
          badges.push({ label: areaLabel(entry.area) });
        }
        for (const trait of (entry.traits || []).slice(0, 3)) {
          badges.push({ label: trait });
        }
        return badges;
      }
      if (categoryId === "weapons") {
        badges.push({
          label: entry.damage.formula + " " + entry.damage.type,
          accent: true,
        });
        badges.push({ label: entry.hands === 2 ? "2H" : "1H" });
        for (const trait of (entry.traits || []).slice(0, 3)) {
          badges.push({ label: trait });
        }
        return badges;
      }
      if (categoryId === "shields") {
        badges.push({ label: "AC +" + entry.acBonus, accent: true });
        badges.push({ label: "Hardness " + entry.hardness });
        badges.push({ label: "HP " + entry.hp });
        return badges;
      }
      badges.push({ label: "Ур. " + entry.level, accent: true });
      badges.push({ label: "HP " + entry.hp });
      badges.push({ label: "AC " + entry.ac });
      for (const trait of (entry.traits || []).slice(0, 2)) {
        badges.push({ label: trait });
      }
      return badges;
    }

    renderBody(entry, categoryId) {
      const doc = this.document;
      const body = make(doc, "div", "compendium-body-inner");

      const description = make(
        doc,
        "p",
        "compendium-description",
        entry.description && entry.description !== ""
          ? entry.description
          : "Описание отсутствует.",
      );
      body.append(description);

      const stats = make(doc, "dl", "compendium-stats");
      for (const row of this.statRows(entry, categoryId)) {
        if (!row || row.value === null || row.value === undefined || row.value === "") {
          continue;
        }
        const group = make(doc, "div", "compendium-stat");
        group.append(
          make(doc, "dt", "compendium-stat-label", row.label),
          make(doc, "dd", "compendium-stat-value", row.value),
        );
        stats.append(group);
      }
      body.append(stats);

      const actions = make(doc, "div", "compendium-actions");
      actions.append(this.renderActionButton(entry, categoryId));
      body.append(actions);
      return body;
    }

    statRows(entry, categoryId) {
      if (categoryId === "spells") {
        return [
          { label: "Ранг", value: entry.isCantrip ? "Кантрип (0)" : entry.rank },
          { label: "Время", value: actionCostLabel(entry.actionCost) },
          { label: "Спасбросок", value: saveLabel(entry.save) },
          { label: "Область", value: areaLabel(entry.area) },
          {
            label: "Урон",
            value: entry.damage
              ? entry.damage.formula + " " + entry.damage.type
              : null,
          },
          {
            label: "Трейты",
            value:
              entry.traits && entry.traits.length > 0
                ? entry.traits.join(", ")
                : null,
          },
          { label: "Focus", value: entry.isFocus ? "Да" : null },
          { label: "Sustained", value: entry.isSustained ? "Да" : null },
        ];
      }
      if (categoryId === "weapons") {
        return [
          { label: "Категория", value: entry.category },
          { label: "Руки", value: entry.hands === 2 ? "2" : "1" },
          {
            label: "Урон",
            value: entry.damage
              ? entry.damage.formula + " " + entry.damage.type
              : null,
          },
          {
            label: "Дистанция",
            value: entry.rangeIncrement
              ? entry.rangeIncrement + " фт"
              : "Ближний бой",
          },
          {
            label: "Перезарядка",
            value:
              entry.reload === null || entry.reload === undefined
                ? null
                : String(entry.reload),
          },
          { label: "Цена", value: coinsLabel(entry.price) },
          {
            label: "Трейты",
            value:
              entry.traits && entry.traits.length > 0
                ? entry.traits.join(", ")
                : null,
          },
        ];
      }
      if (categoryId === "shields") {
        return [
          { label: "AC", value: "+" + entry.acBonus },
          { label: "Твёрдость", value: entry.hardness },
          { label: "HP", value: entry.hp + " / " + entry.maxHP },
          { label: "Broken Threshold", value: entry.brokenThreshold },
          {
            label: "Штраф скорости",
            value:
              entry.speedPenalty === 0
                ? "Нет"
                : "-" + entry.speedPenalty + " фт",
          },
          { label: "Цена", value: coinsLabel(entry.price) },
        ];
      }

      const saves = entry.saves || {};
      const skills = entry.skills || {};
      const attackLines = (entry.attacks || []).map(function (attack) {
        const damage = attack.damage
          ? " · " + attack.damage.formula + " " + attack.damage.type
          : "";
        return (
          attack.name +
          " (" +
          (attack.type === "ranged" ? "ranged" : "melee") +
          " " +
          (attack.attackBonus >= 0 ? "+" : "") +
          attack.attackBonus +
          damage +
          ")"
        );
      });
      const spellLines = (entry.spells || []).map(function (spell) {
        return spell.name + " (ранг " + spell.rank + ")";
      });
      const skillLine = Object.keys(skills)
        .sort()
        .map(function (key) {
          const value = skills[key];
          return key + " " + (value >= 0 ? "+" : "") + value;
        })
        .join(", ");

      return [
        { label: "Уровень", value: entry.level },
        { label: "Размер", value: entry.size },
        { label: "HP", value: entry.hp },
        { label: "AC", value: entry.ac },
        { label: "Восприятие", value: entry.perception },
        { label: "Скорость", value: entry.speed + " фт" },
        {
          label: "Спасброски",
          value:
            "Fort " +
            saves.fortitude +
            " · Ref " +
            saves.reflex +
            " · Will " +
            saves.will,
        },
        { label: "Навыки", value: skillLine },
        {
          label: "Атаки",
          value: attackLines.length > 0 ? attackLines.join("; ") : null,
        },
        {
          label: "Заклинания",
          value: spellLines.length > 0 ? spellLines.join("; ") : null,
        },
        {
          label: "Чувства",
          value:
            entry.senses && entry.senses.length > 0
              ? entry.senses.join(", ")
              : "vision",
        },
        {
          label: "Трейты",
          value:
            entry.traits && entry.traits.length > 0
              ? entry.traits.join(", ")
              : null,
        },
      ];
    }

    renderActionButton(entry, categoryId) {
      const doc = this.document;
      const button = make(doc, "button", "compendium-action");
      button.type = "button";

      if (categoryId === "monsters") {
        button.textContent = "Заспавнить";
        button.classList.add("is-accent");
        button.title = "Создать токен монстра на свободной клетке поля";
        button.addEventListener(
          "click",
          function () {
            this.onSpawnMonster(entry);
          }.bind(this),
        );
        return button;
      }

      const recipients = this.getRecipients(categoryId) || [];
      const recipient = recipients.find(
        function (combatant) {
          return combatant.id === this.recipientId;
        }.bind(this),
      );
      if (!recipient) {
        button.textContent =
          categoryId === "spells" ? "Добавить магу" : "Экипировать";
        button.disabled = true;
        button.title = "Нет доступного получателя.";
        return button;
      }

      if (categoryId === "spells") {
        button.textContent = "Добавить магу";
        button.classList.add("is-accent");
        button.title = "Добавить " + entry.name + " в список заклинаний " + recipient.name;
        button.addEventListener(
          "click",
          function () {
            this.onAddSpell(recipient, entry);
          }.bind(this),
        );
        return button;
      }

      button.textContent = "Экипировать";
      button.classList.add("is-accent");
      button.title = "Добавить " + entry.name + " в инвентарь и взять в руки · " + recipient.name;
      button.addEventListener(
        "click",
        function () {
          this.onEquipItem(recipient, entry);
        }.bind(this),
      );
      return button;
    }

    destroy() {
      this.destroyed = true;
      this.root.replaceChildren();
      this.categoryButtons = new Map();
      this.listEl = null;
    }
  }

  NS.View.CompendiumBrowser = CompendiumBrowser;
  NS.View.COMPENDIUM_CATEGORIES = CATEGORIES;
})(typeof globalThis !== "undefined" ? globalThis : this);
