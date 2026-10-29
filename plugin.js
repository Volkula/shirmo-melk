(function () {
  const SERVICE = "0000fff0-0000-1000-8000-00805f9b34fb";
  const WRITE = "0000fff3-0000-1000-8000-00805f9b34fb";
  const PRESETS = [
    ["#ffb060", "Тёплый"],
    ["#ffffff", "Белый"],
    ["#ff2a2a", "Красный"],
    ["#ff8a00", "Оранжевый"],
    ["#ffe14a", "Жёлтый"],
    ["#3dff6a", "Зелёный"],
    ["#2aa8ff", "Синий"],
    ["#b44dff", "Фиолет"]
  ];
  const MODES = [
    ["Заполнение", [[64, "Красный"], [66, "Зелёный"], [68, "Синий"], [76, "Белый"], [70, "Жёлтый"], [72, "Бирюза"], [74, "Фиолет"], [58, "7 цветов"], [60, "RGB"]]],
    ["Пробежка", [[103, "7 цветов"], [104, "7 назад"], [89, "Красный"], [91, "Зелёный"], [93, "Синий"], [105, "RGB"], [106, "RGB назад"]]],
    ["Базовые", [[0, "Авто"], [1, "Вперёд"], [2, "Назад"]]]
  ];
  const DIALECTS = [
    ["melk", "MELK"],
    ["ox", "OT"],
    ["lotus", "Lotus"],
    ["elk", "ELK"]
  ];

  const lamps = [];
  const checked = new Set();
  const bound = new WeakSet();
  let envRef = null;
  let fadeOn = true;
  let seconds = 1.5;
  let tempo = 40;
  let sensitivity = 60;
  let cmdToken = 0;
  let radioTail = Promise.resolve();
  let statusText = "";
  let recalled = false;
  let foldOpen = false;

  function install(host) {
    ensureStyle();
    host.add({
      id: "melk-lamps",
      settings: function (env) {
        envRef = env;
        hydrate();
        const box = document.createElement("div");
        box.setAttribute("data-melk-root", "");
        fill(box);
        recall();
        return box;
      },
      dockHtml: function () {
        return '<details class="dock-fold" data-fold="melk"' + (foldOpen ? " open" : "") + '><summary>Лампы</summary><div data-melk-root></div></details>';
      },
      boot: function (env) {
        envRef = env;
        hydrate();
        recall();
      },
      bindDock: function (root, env) {
        envRef = env;
        hydrate();
        const fold = root.querySelector('[data-fold="melk"]');
        if (fold) fold.addEventListener("toggle", function () { foldOpen = fold.open; });
        const box = root.querySelector("[data-melk-root]");
        if (box) fill(box);
        recall();
      },
      rgb: {
        label: "Лампы MELK",
        ready: function () { return liveLamps().length > 0; },
        hold: function () {
          const token = ++cmdToken;
          liveLamps().forEach(function (lamp) { lamp.token = token; });
        },
        auto: function (on) {
          const list = liveLamps();
          if (!list.length) return;
          if (on) send(list, function () { return [effectFrame(0)]; }, "Авто");
          else list.forEach(function (lamp) { lamp.token = ++cmdToken; });
        },
        frame: function (rgb, brightness) {
          if (!rgb) return;
          syncPending = { rgb: rgb.slice(), bright: brightness };
          syncWrite();
        }
      }
    });
  }

  function ensureStyle() {
    if (document.getElementById("melk-style")) return;
    const style = document.createElement("style");
    style.id = "melk-style";
    style.textContent = [
      ".dock-fold[data-fold=melk]{min-width:0;max-width:100%}",
      ".melk-panel{display:grid;gap:6px;margin-top:6px;width:100%;min-width:0}",
      ".melk-panel>*{min-width:0;max-width:100%}",
      ".melk-line{display:flex;flex-wrap:wrap;gap:6px;align-items:center;max-width:100%}",
      ".melk-line .melk-grow{flex:1 1 48px;min-width:0;width:auto}",
      ".melk-panel input[type=range]{width:auto}",
      ".melk-panel button.melk-mini,.melk-panel select{padding:4px 8px}",
      ".melk-dot{width:22px;height:22px;padding:0;border-radius:50%}",
      ".melk-swatch{width:14px;height:14px;border-radius:50%;border:1px solid rgba(243,234,216,.45);flex:none;display:inline-block}",
      ".melk-name{flex:1 1 6em;min-width:6em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".melk-lamp{display:flex;flex-wrap:wrap;gap:6px;align-items:center;min-width:0;max-width:100%}",
      ".melk-check{display:flex;gap:6px;align-items:center}",
      ".melk-sec{flex:none;min-width:3.2em;text-align:right;font-size:13px;color:var(--muted)}",
      ".melk-status{margin:0;min-height:1.2em;color:var(--muted);font-size:13px}",
      ".melk-panel input[type=color]{width:36px;height:28px;padding:0;flex:none}",
      ".melk-num{width:4.6em;padding:4px 6px}"
    ].join("");
    document.head.appendChild(style);
  }

  function bag() {
    const env = envRef;
    if (!env || typeof env.campaign !== "function") return null;
    const campaign = env.campaign();
    if (!campaign) return null;
    if (!campaign.plugins || typeof campaign.plugins !== "object" || Array.isArray(campaign.plugins)) campaign.plugins = {};
    if (!campaign.plugins.melk || typeof campaign.plugins.melk !== "object" || Array.isArray(campaign.plugins.melk)) {
      campaign.plugins.melk = { lamps: [], fade: true, seconds: 1.5 };
    }
    return campaign.plugins.melk;
  }

  function hydrate() {
    const data = bag();
    if (!data) return;
    if (typeof data.fade === "boolean") fadeOn = data.fade;
    if (Number(data.seconds) > 0) seconds = clamp(Number(data.seconds), 0.4, 6);
    if (Number.isFinite(Number(data.tempo))) tempo = clamp(Number(data.tempo), 0, 100);
    if (Number.isFinite(Number(data.sensitivity))) sensitivity = clamp(Number(data.sensitivity), 0, 100);
    (Array.isArray(data.lamps) ? data.lamps : []).forEach(function (saved) {
      if (!saved || !saved.id || lamps.some(function (lamp) { return lamp.id === saved.id; })) return;
      lamps.push({
        id: String(saved.id),
        name: String(saved.name || "Лампа"),
        dialect: knownDialect(saved.dialect),
        color: [255, 176, 96],
        brightness: 80,
        device: null,
        char: null,
        token: 0,
        connected: false,
        busy: null
      });
      checked.add(String(saved.id));
    });
  }

  function persist() {
    const data = bag();
    if (!data) return;
    data.lamps = lamps.map(function (lamp) {
      return { id: lamp.id, name: lamp.name, dialect: lamp.dialect };
    });
    data.fade = fadeOn;
    data.seconds = seconds;
    data.tempo = tempo;
    data.sensitivity = sensitivity;
    try { if (envRef && envRef.save) envRef.save(); } catch (err) {}
  }

  function knownDialect(value) {
    return DIALECTS.some(function (row) { return row[0] === value; }) ? value : "melk";
  }

  function guessDialect(name) {
    const text = String(name || "").trim().toUpperCase();
    if (text.indexOf("MELK-OT") === 0) return "ox";
    if (text.indexOf("ELK") === 0) return "elk";
    return "melk";
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function byte(value) {
    return Math.max(0, Math.min(255, Math.round(value)));
  }

  function hexOf(rgb) {
    return "#" + rgb.map(function (part) { return ("0" + byte(part).toString(16)).slice(-2); }).join("");
  }

  function parseHex(hex) {
    const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
    if (!match) return [255, 255, 255];
    const num = parseInt(match[1], 16);
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  }

  function mix(from, to, t) {
    return [0, 1, 2].map(function (index) { return from[index] + (to[index] - from[index]) * t; });
  }

  function secLabel(value) {
    return Number(value).toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + " с";
  }

  function bleNote() {
    if (!navigator.bluetooth) return "В этом браузере нет Bluetooth. Открой ширму в Chrome.";
    if (!window.isSecureContext) return "Bluetooth из браузера открывается на https.";
    return "";
  }

  function setStatus(text) {
    statusText = text || "";
    document.querySelectorAll("[data-melk-status]").forEach(function (node) { node.textContent = statusText; });
  }

  function fail(err) {
    if (!err || err.name === "NotFoundError") return;
    if (err.name === "NetworkError") setStatus("Лампа занята другим подключением");
    else if (err.name === "SecurityError") setStatus("Bluetooth из браузера открывается на https");
    else if (err.name === "NotSupportedError") setStatus("В этом браузере нет Bluetooth");
    else setStatus(err.message || "не вышло");
  }

  function paintSwatches() {
    lamps.forEach(function (lamp) {
      document.querySelectorAll('[data-swatch="' + cssAttr(lamp.id) + '"]').forEach(function (node) {
        node.style.background = lamp.connected ? hexOf(lamp.color) : "transparent";
      });
    });
  }

  function cssAttr(value) {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return String(value).replace(/"/g, "");
  }

  function paint() {
    document.querySelectorAll("[data-melk-root]").forEach(fill);
  }

  function liveLamps() {
    return lamps.filter(function (lamp) { return checked.has(lamp.id) && lamp.connected && lamp.char; });
  }

  let syncPending = null;
  let syncBusy = false;

  function syncWrite() {
    if (syncBusy) return;
    const list = liveLamps();
    const frame = syncPending;
    if (!list.length || !frame) return;
    syncPending = null;
    syncBusy = true;
    const token = ++cmdToken;
    list.forEach(function (lamp) {
      lamp.token = token;
      lamp.color = frame.rgb.slice();
      lamp.brightness = frame.bright;
    });
    paintSwatches();
    radio(function () {
      const jobs = [];
      list.forEach(function (lamp) {
        jobs.push({ lamp: lamp, bytes: colorFrame(lamp, frame.rgb) });
        jobs.push({ lamp: lamp, bytes: brightFrame(lamp, frame.bright) });
      });
      return writeJobs(jobs);
    }).then(function () {
      syncBusy = false;
      if (syncPending) syncWrite();
    }, function () {
      syncBusy = false;
    });
  }

  function chosen() {
    return lamps.filter(function (lamp) { return checked.has(lamp.id) && lamp.connected && lamp.char; });
  }

  function need() {
    const list = chosen();
    if (list.length) return list;
    setStatus(lamps.some(function (lamp) { return lamp.connected; }) ? "Отметь лампу" : "Сначала свяжи лампу");
    return null;
  }

  function bump(list) {
    const token = ++cmdToken;
    list.forEach(function (lamp) { lamp.token = token; });
    return token;
  }

  function alive(list, token) {
    return list.every(function (lamp) { return lamp.token === token && lamp.char; });
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function radio(job) {
    const run = radioTail.then(job, job);
    radioTail = run.then(function () { return sleep(20); }, function () { return sleep(20); });
    return run;
  }

  async function writeOne(lamp, bytes) {
    const data = new Uint8Array(bytes);
    const props = lamp.char && lamp.char.properties || {};
    if (props.writeWithoutResponse) await lamp.char.writeValueWithoutResponse(data);
    else await lamp.char.writeValue(data);
  }

  async function writeJobs(jobs) {
    for (let index = 0; index < jobs.length; index++) {
      const job = jobs[index];
      if (!job.lamp.char) continue;
      await writeOne(job.lamp, job.bytes);
      if (index + 1 < jobs.length) await sleep(20);
    }
  }

  function colorFrame(lamp, rgb) {
    const r = byte(rgb[0]);
    const g = byte(rgb[1]);
    const b = byte(rgb[2]);
    if (lamp.dialect === "lotus") return [0x7e, 0x07, 0x05, 0x03, r, g, b, 0x10, 0xef];
    return [0x7e, 0x00, 0x05, 0x03, r, g, b, 0x00, 0xef];
  }

  function powerFrame(lamp, on) {
    if (lamp.dialect === "ox" || lamp.dialect === "lotus") {
      return on
        ? [0x7e, 0x04, 0x04, 0xf0, 0x00, 0x01, 0xff, 0x00, 0xef]
        : [0x7e, 0x04, 0x04, 0x00, 0x00, 0x00, 0xff, 0x00, 0xef];
    }
    if (lamp.dialect === "elk") {
      return on
        ? [0x7e, 0x00, 0x04, 0xf0, 0x00, 0x01, 0xff, 0x00, 0xef]
        : [0x7e, 0x00, 0x04, 0x00, 0x00, 0x00, 0xff, 0x00, 0xef];
    }
    return on
      ? [0x7e, 0x00, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0xef]
      : [0x7e, 0x00, 0x04, 0x00, 0x00, 0x00, 0xff, 0x00, 0xef];
  }

  function brightFrame(lamp, level) {
    const value = clamp(Math.round(level), 0, 100);
    if (lamp.dialect === "elk") return [0x7e, 0x00, 0x01, value, 0xff, 0x00, 0xff, 0x00, 0xef];
    if (lamp.dialect === "ox" || lamp.dialect === "lotus") return [0x7e, 0x04, 0x01, value, 0x01, 0xff, 0xff, 0x00, 0xef];
    return [0x7e, 0x04, 0x01, value, 0xff, 0x00, 0xff, 0x00, 0xef];
  }

  function speedFrame(level) {
    return [0x7e, 0x04, 0x02, clamp(Math.round(level), 0, 100), 0xff, 0xff, 0xff, 0x00, 0xef];
  }

  function effectFrame(id) {
    return [0x7e, 0x05, 0x03, id & 255, 0x06, 0xff, 0xff, 0x00, 0xef];
  }

  function send(list, frames, label) {
    bump(list);
    setStatus(label);
    return radio(function () {
      const jobs = [];
      list.forEach(function (lamp) {
        frames(lamp).forEach(function (bytes) { jobs.push({ lamp: lamp, bytes: bytes }); });
      });
      return writeJobs(jobs);
    }).then(function () { setStatus("Готово"); }).catch(fail);
  }

  function applyColor(rgb) {
    const list = need();
    if (!list) return;
    document.querySelectorAll("[data-melk-pick]").forEach(function (node) { node.value = hexOf(rgb); });
    if (!fadeOn) {
      list.forEach(function (lamp) { lamp.color = rgb.slice(); });
      paintSwatches();
      send(list, function (lamp) { return [colorFrame(lamp, rgb)]; }, "Цвет");
      return;
    }
    const token = bump(list);
    const from = list.map(function (lamp) { return lamp.color.slice(); });
    const steps = Math.max(2, Math.round(seconds / 0.12));
    const gap = Math.max(0, seconds / steps - 0.04);
    let step = 0;
    setStatus("Переход");
    function tick() {
      if (!alive(list, token)) return;
      step += 1;
      const t = step / steps;
      const jobs = list.map(function (lamp, index) {
        lamp.color = mix(from[index], rgb, t);
        return { lamp: lamp, bytes: colorFrame(lamp, lamp.color) };
      });
      paintSwatches();
      radio(function () {
        return writeJobs(jobs).then(function () { return gap ? sleep(gap * 1000) : null; });
      }).then(function () {
        if (!alive(list, token)) return;
        if (step < steps) tick();
        else setStatus("Готово");
      }).catch(fail);
    }
    tick();
  }

  function applyBright(level) {
    const list = need();
    if (!list) return;
    const goal = clamp(Math.round(level), 0, 100);
    if (!fadeOn) {
      list.forEach(function (lamp) { lamp.brightness = goal; });
      send(list, function (lamp) { return [brightFrame(lamp, goal)]; }, "Яркость");
      return;
    }
    const token = bump(list);
    const from = list.map(function (lamp) { return lamp.brightness; });
    const steps = Math.max(2, Math.round(seconds / 0.12));
    const gap = Math.max(0, seconds / steps - 0.04);
    let step = 0;
    setStatus("Переход");
    function tick() {
      if (!alive(list, token)) return;
      step += 1;
      const t = step / steps;
      const jobs = list.map(function (lamp, index) {
        lamp.brightness = from[index] + (goal - from[index]) * t;
        return { lamp: lamp, bytes: brightFrame(lamp, lamp.brightness) };
      });
      radio(function () {
        return writeJobs(jobs).then(function () { return gap ? sleep(gap * 1000) : null; });
      }).then(function () {
        if (!alive(list, token)) return;
        if (step < steps) tick();
        else {
          list.forEach(function (lamp) { lamp.brightness = goal; });
          setStatus("Готово");
        }
      }).catch(fail);
    }
    tick();
  }

  function applyMode(id) {
    const list = need();
    if (!list) return;
    const speed = clamp(Math.round(tempo), 0, 100);
    send(list, function (lamp) { return [effectFrame(id), speedFrame(speed)]; }, "Режим");
  }

  function applyMic(variant) {
    const list = need();
    if (!list) return;
    const sens = clamp(Math.round(sensitivity), 0, 100);
    const code = 0x80 + clamp(variant, 0, 7);
    send(list, function () {
      return [
        [0x7e, 0x04, 0x07, 0x01, 0xff, 0xff, 0xff, 0x00, 0xef],
        [0x7e, 0x04, 0x06, sens, 0xff, 0xff, 0xff, 0x00, 0xef],
        [0x7e, 0x05, 0x03, code, 0x04, 0xff, 0xff, 0x00, 0xef]
      ];
    }, "Звук");
  }

  function applyMicOff() {
    const list = need();
    if (!list) return;
    send(list, function () { return [[0x7e, 0x04, 0x07, 0x00, 0xff, 0xff, 0xff, 0x00, 0xef]]; }, "Звук выключен");
  }

  function applyPower(on) {
    const list = need();
    if (!list) return;
    send(list, function (lamp) { return [powerFrame(lamp, on)]; }, on ? "Включены" : "Выключены");
  }

  function watch(device) {
    if (bound.has(device)) return;
    bound.add(device);
    device.addEventListener("gattserverdisconnected", function () {
      const lamp = lamps.find(function (item) { return item.device === device; });
      if (!lamp) return;
      lamp.connected = false;
      lamp.char = null;
      paint();
      if (lamp.gone) return;
      setStatus(lamp.name + " отключилась");
      lamp.tries = (lamp.tries || 0) + 1;
      if (lamp.tries > 2) return;
      setTimeout(function () {
        if (lamp.gone || lamp.connected || lamp.device !== device) return;
        openDevice(device).catch(function () {});
      }, 700);
    });
  }

  async function openDevice(device) {
    let lamp = lamps.find(function (item) { return item.id === device.id; });
    if (!lamp) {
      lamp = {
        id: device.id,
        name: String(device.name || "Лампа").trim() || "Лампа",
        dialect: guessDialect(device.name),
        color: [255, 176, 96],
        brightness: 80,
        device: null,
        char: null,
        token: 0,
        connected: false,
        busy: null
      };
      lamps.push(lamp);
      checked.add(lamp.id);
    } else if (device.name) {
      lamp.name = String(device.name).trim() || lamp.name;
    }
    lamp.device = device;
    watch(device);
    if (lamp.busy) return lamp.busy;
    const job = (async function () {
      setStatus("Связь с " + lamp.name);
      const server = await device.gatt.connect();
      const service = await server.getPrimaryService(SERVICE);
      lamp.char = await service.getCharacteristic(WRITE);
      lamp.connected = true;
      lamp.tries = 0;
      persist();
      paint();
      await radio(async function () {
        await writeOne(lamp, [0x7e, 0x07, 0x83]);
        await sleep(160);
        await writeOne(lamp, powerFrame(lamp, true));
        await sleep(80);
        await writeOne(lamp, colorFrame(lamp, lamp.color));
        await sleep(40);
        await writeOne(lamp, brightFrame(lamp, lamp.brightness));
      });
      setStatus(lamp.name + " на связи");
    })();
    lamp.busy = job;
    try { await job; }
    finally { lamp.busy = null; }
  }

  function ask(filters) {
    const note = bleNote();
    if (note) { setStatus(note); return; }
    const options = filters
      ? { filters: filters, optionalServices: [SERVICE] }
      : { acceptAllDevices: true, optionalServices: [SERVICE] };
    navigator.bluetooth.requestDevice(options).then(openDevice).catch(fail);
  }

  function recall() {
    if (recalled || !navigator.bluetooth || !navigator.bluetooth.getDevices) return;
    recalled = true;
    navigator.bluetooth.getDevices().then(function (list) {
      return lamps.reduce(function (chain, lamp) {
        if (lamp.connected) return chain;
        const device = list.find(function (item) { return item.id === lamp.id; });
        if (!device) return chain;
        return chain.then(function () { return openDevice(device); }).catch(function () {});
      }, Promise.resolve());
    }).catch(function () {});
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function fill(root) {
    root.replaceChildren();
    root.className = "melk-panel";
    const blocked = bleNote();
    if (blocked) root.append(el("p", "note", blocked));

    lamps.forEach(function (lamp) {
      const row = el("div", "melk-lamp");
      const mark = document.createElement("input");
      mark.type = "checkbox";
      mark.checked = checked.has(lamp.id);
      mark.setAttribute("aria-label", lamp.name);
      mark.addEventListener("change", function () {
        if (mark.checked) checked.add(lamp.id);
        else checked.delete(lamp.id);
      });
      const swatch = el("i", "melk-swatch");
      swatch.setAttribute("data-swatch", lamp.id);
      swatch.style.background = lamp.connected ? hexOf(lamp.color) : "transparent";
      const name = el("span", "melk-name", lamp.name);
      const dialect = document.createElement("select");
      dialect.setAttribute("aria-label", "Протокол " + lamp.name);
      DIALECTS.forEach(function (item) {
        const option = document.createElement("option");
        option.value = item[0];
        option.textContent = item[1];
        dialect.append(option);
      });
      dialect.value = lamp.dialect;
      dialect.addEventListener("change", function () {
        lamp.dialect = knownDialect(dialect.value);
        persist();
      });
      row.append(mark, swatch, name, dialect);
      if (!lamp.connected) {
        const link = el("button", "melk-mini", "найти");
        link.type = "button";
        link.addEventListener("click", function () { ask([{ namePrefix: "MELK" }, { namePrefix: "ELK" }]); });
        row.append(link);
      }
      const drop = el("button", "melk-mini", "×");
      drop.type = "button";
      drop.setAttribute("aria-label", "Убрать " + lamp.name);
      drop.addEventListener("click", function () {
        lamp.gone = true;
        bump([lamp]);
        try { if (lamp.device && lamp.device.gatt && lamp.device.gatt.connected) lamp.device.gatt.disconnect(); } catch (err) {}
        checked.delete(lamp.id);
        const index = lamps.indexOf(lamp);
        if (index >= 0) lamps.splice(index, 1);
        persist();
        paint();
      });
      row.append(drop);
      root.append(row);
    });

    const acts = el("div", "melk-line");
    const add = el("button", "melk-mini", "Добавить");
    add.type = "button";
    add.addEventListener("click", function () { ask([{ namePrefix: "MELK" }, { namePrefix: "ELK" }]); });
    const any = el("button", "melk-mini", "Любая");
    any.type = "button";
    any.title = "Показать все Bluetooth-устройства рядом";
    any.addEventListener("click", function () { ask(null); });
    const on = el("button", "melk-mini", "Вкл");
    on.type = "button";
    on.addEventListener("click", function () { applyPower(true); });
    const off = el("button", "melk-mini", "Выкл");
    off.type = "button";
    off.addEventListener("click", function () { applyPower(false); });
    acts.append(add, any, on, off);
    root.append(acts);

    const colors = el("div", "melk-line");
    PRESETS.forEach(function (preset) {
      const dot = el("button", "melk-dot");
      dot.type = "button";
      dot.title = preset[1];
      dot.setAttribute("aria-label", preset[1]);
      dot.style.background = preset[0];
      dot.addEventListener("click", function () { applyColor(parseHex(preset[0])); });
      colors.append(dot);
    });
    const pick = document.createElement("input");
    pick.type = "color";
    pick.className = "melk-pick";
    pick.setAttribute("data-melk-pick", "");
    pick.value = lamps.length ? hexOf(lamps[0].color) : "#ffb060";
    pick.setAttribute("aria-label", "Свой цвет");
    pick.addEventListener("change", function () { applyColor(parseHex(pick.value)); });
    colors.append(pick);
    root.append(colors);

    const fadeRow = el("div", "melk-line");
    const fadeLabel = el("label", "melk-check");
    const fadeBox = document.createElement("input");
    fadeBox.type = "checkbox";
    fadeBox.checked = fadeOn;
    fadeLabel.append(fadeBox, document.createTextNode("Автопереход"));
    fadeBox.addEventListener("change", function () {
      fadeOn = fadeBox.checked;
      if (!fadeOn) bump(lamps.filter(function (lamp) { return checked.has(lamp.id); }));
      persist();
      paint();
    });
    fadeRow.append(fadeLabel);
    if (fadeOn) {
      const range = document.createElement("input");
      range.type = "range";
      range.className = "melk-grow";
      range.min = "0.4";
      range.max = "6";
      range.step = "0.1";
      range.value = String(seconds);
      range.setAttribute("aria-label", "Длительность перехода");
      const label = el("span", "melk-sec", secLabel(seconds));
      label.setAttribute("data-melk-sec", "");
      range.addEventListener("input", function () {
        seconds = clamp(Number(range.value) || 1.5, 0.4, 6);
        document.querySelectorAll("[data-melk-sec]").forEach(function (node) { node.textContent = secLabel(seconds); });
        document.querySelectorAll("[data-melk-seconds]").forEach(function (node) { node.value = String(seconds); });
      });
      range.setAttribute("data-melk-seconds", "");
      range.addEventListener("change", persist);
      fadeRow.append(label, range);
    }
    root.append(fadeRow);

    const brightRow = el("div", "melk-line");
    brightRow.append(el("span", "", "Яркость"));
    const bright = document.createElement("input");
    bright.type = "range";
    bright.className = "melk-grow";
    bright.min = "0";
    bright.max = "100";
    bright.step = "1";
    bright.value = String(lamps.length ? Math.round(lamps[0].brightness) : 80);
    bright.setAttribute("aria-label", "Яркость");
    bright.addEventListener("change", function () { applyBright(Number(bright.value)); });
    brightRow.append(bright);
    root.append(brightRow);

    const modeRow = el("div", "melk-line");
    const mode = document.createElement("select");
    mode.setAttribute("aria-label", "Режим");
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = "Режим";
    mode.append(blank);
    MODES.forEach(function (group) {
      const pack = document.createElement("optgroup");
      pack.label = group[0];
      group[1].forEach(function (item) {
        const option = document.createElement("option");
        option.value = String(item[0]);
        option.textContent = item[1];
        pack.append(option);
      });
      mode.append(pack);
    });
    mode.addEventListener("change", function () {
      if (mode.value === "") return;
      applyMode(Number(mode.value));
      mode.value = "";
    });
    const speed = document.createElement("input");
    speed.type = "range";
    speed.className = "melk-grow";
    speed.min = "0";
    speed.max = "100";
    speed.step = "1";
    speed.value = String(tempo);
    speed.setAttribute("aria-label", "Темп режима");
    speed.title = "Темп встроенного режима";
    speed.addEventListener("change", function () {
      tempo = clamp(Math.round(Number(speed.value) || 0), 0, 100);
      persist();
      const list = chosen();
      if (!list.length) return;
      send(list, function () { return [speedFrame(tempo)]; }, "Темп");
    });
    modeRow.append(mode, speed);
    root.append(modeRow);

    const extra = el("div", "melk-line");
    const custom = document.createElement("input");
    custom.type = "number";
    custom.className = "melk-num";
    custom.min = "0";
    custom.max = "255";
    custom.placeholder = "№";
    custom.setAttribute("aria-label", "Свой номер режима");
    const go = el("button", "melk-mini", "пуск");
    go.type = "button";
    function runCustom() {
      if (custom.value === "") return;
      const id = Math.round(Number(custom.value));
      if (!Number.isFinite(id)) return;
      applyMode(clamp(id, 0, 255));
    }
    go.addEventListener("click", runCustom);
    custom.addEventListener("change", runCustom);
    const mic = document.createElement("select");
    mic.setAttribute("aria-label", "Звук");
    const micBlank = document.createElement("option");
    micBlank.value = "";
    micBlank.textContent = "Звук";
    mic.append(micBlank);
    for (let index = 0; index < 8; index++) {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = "Звук " + (index + 1);
      mic.append(option);
    }
    mic.addEventListener("change", function () {
      if (mic.value === "") return;
      applyMic(Number(mic.value));
      mic.value = "";
    });
    const quiet = el("button", "melk-mini", "тихо");
    quiet.type = "button";
    quiet.addEventListener("click", applyMicOff);
    const sens = document.createElement("input");
    sens.type = "range";
    sens.className = "melk-grow";
    sens.min = "0";
    sens.max = "100";
    sens.step = "1";
    sens.value = String(sensitivity);
    sens.setAttribute("aria-label", "Чувствительность микрофона");
    sens.title = "Чувствительность микрофона";
    sens.addEventListener("change", function () {
      sensitivity = clamp(Math.round(Number(sens.value) || 0), 0, 100);
      persist();
      const list = chosen();
      if (!list.length) return;
      send(list, function () {
        return [[0x7e, 0x04, 0x06, sensitivity, 0xff, 0xff, 0xff, 0x00, 0xef]];
      }, "Чувствительность");
    });
    extra.append(custom, go, mic, quiet, sens);
    root.append(extra);

    const status = el("p", "melk-status", statusText);
    status.setAttribute("data-melk-status", "");
    root.append(status);
  }

  if (window.ShirmoHost) install(window.ShirmoHost);
  else window.addEventListener("shirmo-host", function () { install(window.ShirmoHost); }, { once: true });
})();
