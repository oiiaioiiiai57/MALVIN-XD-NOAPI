const { mxd } = require("../king");
const axios = require("axios");
const { classifyApiError } = require("../king/mxdcore2");

// ==================== TEXT UTILITIES ====================
// Brand new category (/api/text/*) — 28 simple text-manipulation
// endpoints, all following the same envelope: { status, data, timestamp }.
// Args are passed pipe-separated in the order listed for each command;
// trailing optional args can be omitted.

const COMMANDS = {
    affine:        { params: ["text", "a", "b", "mode"], required: 1, usage: ".affine <text> | <a> | <b> | <mode: encode|decode>" },
    anagram:       { params: ["a", "b", "ignore_case", "ignore_non_alnum"], required: 2, usage: ".anagram <text1> | <text2>" },
    case:          { params: ["text", "to"], required: 1, usage: ".case <text> | <to: upper|lower|title|camel|pascal|snake|kebab|constant>" },
    charfreq:      { params: ["text", "ignore_case", "ignore_whitespace"], required: 1, usage: ".charfreq <text>", endpoint: "char-frequency" },
    charinfo:      { params: ["char"], required: 1, usage: ".charinfo <single character>", endpoint: "char-info" },
    textcount:     { params: ["text"], required: 1, usage: ".textcount <text>", endpoint: "count" },
    textdiff:      { params: ["a", "b"], required: 2, usage: ".textdiff <text1> | <text2>", endpoint: "diff" },
    escapetext:    { params: ["text", "mode", "type"], required: 1, usage: ".escapetext <text> | <mode: escape|unescape> | <type: html|url|json|regex>", endpoint: "escape" },
    findreplace:   { params: ["text", "find", "replace", "regex", "flags"], required: 3, usage: ".findreplace <text> | <find> | <replace>" },
    leetspeak:     { params: ["text", "level"], required: 1, usage: ".leetspeak <text> | <level: 1-3>" },
    linenumbers:   { params: ["text", "separator", "start"], required: 1, usage: ".linenumbers <text>", endpoint: "line-numbers" },
    md2text:       { params: ["text"], required: 1, usage: ".md2text <markdown text>", endpoint: "markdown" },
    padtext:       { params: ["text", "length", "char", "mode"], required: 1, usage: ".padtext <text> | <length> | <char> | <mode: left|right|center>", endpoint: "pad" },
    palindrome:    { params: ["text", "ignore_case", "ignore_non_alnum"], required: 1, usage: ".palindrome <text>" },
    piglatin:      { params: ["text"], required: 1, usage: ".piglatin <text>", endpoint: "pig-latin" },
    railfence:     { params: ["text", "rails", "mode"], required: 1, usage: ".railfence <text> | <rails> | <mode: encode|decode>", endpoint: "rail-fence" },
    readingtime:   { params: ["text", "wpm"], required: 1, usage: ".readingtime <text>", endpoint: "reading-time" },
    regextest:     { params: ["pattern", "text", "flags"], required: 2, usage: ".regextest <pattern> | <text> | <flags>", endpoint: "regex" },
    reversetext:   { params: ["text", "mode"], required: 1, usage: ".reversetext <text> | <mode: chars|words|lines>", endpoint: "reverse" },
    rot47:         { params: ["text"], required: 1, usage: ".rot47 <text>" },
    sorttext:      { params: ["text", "by", "order"], required: 1, usage: ".sorttext <text> | <by: lines|words|chars> | <order: asc|desc>", endpoint: "sort" },
    striphtml:     { params: ["text", "decode_entities", "trim"], required: 1, usage: ".striphtml <html text>", endpoint: "strip-html" },
    syllablecount: { params: ["text"], required: 1, usage: ".syllablecount <text>", endpoint: "syllable-count" },
    textstat:      { params: ["text"], required: 1, usage: ".textstat <text>", endpoint: "text-stat" },
    truncatetext:  { params: ["text", "length", "ellipsis", "word_boundary"], required: 1, usage: ".truncatetext <text> | <length> | <ellipsis>", endpoint: "truncate" },
    uniquetext:    { params: ["text", "by", "ci"], required: 1, usage: ".uniquetext <text> | <by: lines|words|chars>", endpoint: "unique" },
    wordfreq:      { params: ["text", "limit", "order"], required: 1, usage: ".wordfreq <text> | <limit> | <order: asc|desc>", endpoint: "word-frequency" },
    wraptext:      { params: ["text", "width", "break_long"], required: 1, usage: ".wraptext <text> | <width>", endpoint: "wrap" },
};

async function callTextApi(endpoint, params, conText) {
    // Local implementation (no API key). Mirrors the old /text/* results.
    const get = (k, d = "") => (params[k] ?? d);
    switch (endpoint) {
        case "affine": {
            const text = get("text"), a = parseInt(get("a", "5")), b = parseInt(get("b", "8")), mode = (get("mode", "encode")).toLowerCase();
            const mod = (n, m) => ((n % m) + m) % m;
            const modInv = (x, m) => { for (let i = 1; i < m; i++) if ((x * i) % m === 1) return i; return 1; };
            const out = [...text].map(ch => {
                const isU = ch >= "A" && ch <= "Z", isL = ch >= "a" && ch <= "z";
                if (!isU && !isL) return ch;
                const base = isU ? 65 : 97, x = ch.charCodeAt(0) - base;
                const y = mode === "decode" ? mod(modInv(a, 26) * (x - b), 26) : mod(a * x + b, 26);
                return String.fromCharCode(base + y);
            }).join("");
            return { result: out };
        }
        case "anagram": {
            const norm = (s) => (get("ignore_case") === "false" ? s : s.toLowerCase()).replace(get("ignore_non_alnum") === "false" ? /(?!)/ : /[^a-z0-9]/gi, "").split("").sort().join("");
            return { result: norm(get("a")) === norm(get("b")) ? "Yes, they are anagrams." : "No, not anagrams." };
        }
        case "case": {
            const t = get("text"), to = get("to", "upper").toLowerCase();
            const words = t.split(/\s+/);
            const out = to === "upper" ? t.toUpperCase() : to === "lower" ? t.toLowerCase()
                : to === "title" ? words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ")
                : to === "camel" ? words.map((w, i) => i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join("")
                : to === "pascal" ? words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join("")
                : to === "snake" ? t.toLowerCase().replace(/\s+/g, "_") : to === "kebab" ? t.toLowerCase().replace(/\s+/g, "-")
                : to === "constant" ? t.toUpperCase().replace(/\s+/g, "_") : t;
            return { result: out };
        }
        case "char-frequency": {
            const t = get("text"); const ic = get("ignore_case", "true") !== "false", iw = get("ignore_whitespace", "true") !== "false";
            const freq = {};
            for (const ch of ic ? t.toLowerCase() : t) { if (iw && /\s/.test(ch)) continue; freq[ch] = (freq[ch] || 0) + 1; }
            return { result: Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([c, n]) => ({ char: c, count: n })) };
        }
        case "char-info": {
            const ch = (get("char") || "?")[0];
            return { char: ch, code: ch.charCodeAt(0), hex: "U+" + ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0"), name: /\d/.test(ch) ? "Digit" : /[a-z]/i.test(ch) ? "Letter" : /\s/.test(ch) ? "Whitespace" : "Symbol" };
        }
        case "count": {
            const t = get("text");
            return { chars: t.length, chars_no_spaces: t.replace(/\s/g, "").length, words: t.trim() ? t.trim().split(/\s+/).length : 0, lines: t.split("\n").length };
        }
        case "diff": {
            const a = get("a").split("\n"), b = get("b").split("\n");
            const out = []; const max = Math.max(a.length, b.length);
            for (let i = 0; i < max; i++) { if (a[i] === b[i]) out.push(`  ${a[i] ?? ""}`); else { if (a[i] !== undefined) out.push(`- ${a[i]}`); if (b[i] !== undefined) out.push(`+ ${b[i]}`); } }
            return { result: out.join("\n") };
        }
        case "escape": {
            const t = get("text"), mode = get("mode", "escape").toLowerCase(), type = get("type", "html").toLowerCase();
            if (type === "url") return { result: mode === "unescape" ? decodeURIComponent(t) : encodeURIComponent(t) };
            if (type === "json") return { result: mode === "unescape" ? JSON.parse(`"${t}"`) : JSON.stringify(t).slice(1, -1) };
            if (type === "regex") return { result: mode === "unescape" ? t.replace(/\\(.)/g, "$1") : t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") };
            return { result: mode === "unescape" ? t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"') : t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;") };
        }
        case "findreplace": {
            const t = get("text"), find = get("find"), rep = get("replace", ""), isRegex = get("regex", "false") === "true", flags = get("flags", "g");
            const re = isRegex ? new RegExp(find, flags) : new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
            return { result: t.replace(re, rep) };
        }
        case "leetspeak": {
            const lvl = parseInt(get("level", "1")); let t = get("text");
            const m1 = { a: "4", e: "3", i: "1", o: "0", s: "5", t: "7" };
            const m2 = { ...m1, b: "8", g: "6", l: "|", z: "2" };
            const m3 = { ...m2, c: "(", d: "|)", f: "ph", h: "#", k: "|<", m: "|\\/|", n: "|\\|", p: "|>", u: "|_|", v: "\\/", w: "\\/\\/", x: "><", y: "`/" };
            const map = lvl >= 3 ? m3 : lvl === 2 ? m2 : m1;
            return { result: [...t].map(ch => map[ch.toLowerCase()] ?? ch).join("") };
        }
        case "line-numbers": {
            const sep = get("separator", ". "), start = parseInt(get("start", "1"));
            return { result: get("text").split("\n").map((l, i) => `${start + i}${sep}${l}`).join("\n") };
        }
        case "markdown": {
            return { result: get("text").replace(/[#*_`>\[\]()]/g, "").replace(/\n{3,}/g, "\n\n").trim() };
        }
        case "pad": {
            const len = parseInt(get("length", "20")), ch = get("char", " ") || " ", mode = get("mode", "right").toLowerCase();
            const t = get("text");
            return { result: mode === "left" ? t.padStart(len, ch) : mode === "center" ? t.padStart(Math.floor((len + t.length) / 2), ch).padEnd(len, ch) : t.padEnd(len, ch) };
        }
        case "palindrome": {
            const ic = get("ignore_case", "true") !== "false", ia = get("ignore_non_alnum", "true") !== "false";
            let s = get("text"); if (ic) s = s.toLowerCase(); if (ia) s = s.replace(/[^a-z0-9]/gi, "");
            return { is_palindrome: s === [...s].reverse().join(""), result: s === [...s].reverse().join("") ? "Yes, it is a palindrome." : "No, not a palindrome." };
        }
        case "pig-latin": {
            return { result: get("text").split(/\s+/).map(w => /^[aeiou]/i.test(w) ? w + "way" : w.slice(1) + w[0] + "ay").join(" ") };
        }
        case "rail-fence": {
            const rails = Math.max(2, parseInt(get("rails", "3"))), mode = get("mode", "encode").toLowerCase(), t = get("text");
            if (mode === "decode") {
                const fence = Array.from({ length: t.length }, () => 0); let r = 0, d = 1;
                for (let i = 0; i < t.length; i++) { fence[i] = r; r += d; if (r === 0 || r === rails - 1) d = -d; }
                const out = new Array(t.length); let k = 0;
                for (let rail = 0; rail < rails; rail++) for (let i = 0; i < t.length; i++) if (fence[i] === rail) out[i] = t[k++];
                return { result: out.join("") };
            }
            const fence = Array.from({ length: rails }, () => []); let r = 0, d = 1;
            for (const ch of t) { fence[r].push(ch); r += d; if (r === 0 || r === rails - 1) d = -d; }
            return { result: fence.flat().join("") };
        }
        case "reading-time": {
            const wpm = parseInt(get("wpm", "200")), words = get("text").trim().split(/\s+/).length;
            return { words, minutes: +(words / wpm).toFixed(2), result: `~${Math.max(1, Math.ceil(words / wpm))} min read (${words} words)` };
        }
        case "regex": {
            const re = new RegExp(get("pattern"), get("flags", "g"));
            const matches = [...get("text").matchAll(re)].map(m => m[0]).slice(0, 20);
            return { result: matches.length ? matches.map((m, i) => `${i + 1}. ${m}`).join("\n") : "No matches." };
        }
        case "reverse": {
            const mode = get("mode", "chars").toLowerCase(), t = get("text");
            return { result: mode === "words" ? t.split(/\s+/).reverse().join(" ") : mode === "lines" ? t.split("\n").reverse().join("\n") : [...t].reverse().join("") };
        }
        case "rot47": {
            return { result: [...get("text")].map(ch => { const c = ch.charCodeAt(0); return c >= 33 && c <= 126 ? String.fromCharCode(33 + ((c - 33 + 47) % 94)) : ch; }).join("") };
        }
        case "sort": {
            const by = get("by", "lines").toLowerCase(), order = get("order", "asc").toLowerCase();
            const parts = by === "words" ? get("text").split(/\s+/) : by === "chars" ? [...get("text")] : get("text").split("\n");
            parts.sort(); if (order === "desc") parts.reverse();
            return { result: by === "words" ? parts.join(" ") : by === "chars" ? parts.join("") : parts.join("\n") };
        }
        case "strip-html": {
            let t = get("text").replace(/<[^>]*>/g, "");
            if (get("decode_entities", "true") !== "false") t = t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
            if (get("trim", "true") !== "false") t = t.trim();
            return { result: t };
        }
        case "syllable-count": {
            const words = get("text").toLowerCase().split(/\s+/);
            const count = (w) => { w = w.replace(/[^a-z]/g, ""); if (!w) return 0; const m = w.replace(/e$/, "").match(/[aeiouy]+/g); return Math.max(1, m ? m.length : 1); };
            return { words: words.length, syllables: words.reduce((s, w) => s + count(w), 0) };
        }
        case "text-stat": {
            const t = get("text");
            return { chars: t.length, words: t.trim().split(/\s+/).length, lines: t.split("\n").length, sentences: (t.match(/[.!?]+/g) || []).length };
        }
        case "truncate": {
            const len = parseInt(get("length", "100")), ell = get("ellipsis", "..."), wb = get("word_boundary", "true") !== "false";
            let t = get("text");
            if (t.length > len) { t = t.slice(0, len); if (wb) t = t.slice(0, t.lastIndexOf(" ") > 0 ? t.lastIndexOf(" ") : len); t += ell; }
            return { result: t };
        }
        case "unique": {
            const by = get("by", "lines").toLowerCase(), ci = get("ci", "false") === "true";
            const parts = by === "words" ? get("text").split(/\s+/) : by === "chars" ? [...get("text")] : get("text").split("\n");
            const seen = new Set(), out = [];
            for (const p of parts) { const k = ci ? p.toLowerCase() : p; if (!seen.has(k)) { seen.add(k); out.push(p); } }
            return { result: by === "words" ? out.join(" ") : by === "chars" ? out.join("") : out.join("\n") };
        }
        case "word-frequency": {
            const limit = parseInt(get("limit", "10")), order = get("order", "desc").toLowerCase();
            const freq = {};
            for (const w of get("text").toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean)) freq[w] = (freq[w] || 0) + 1;
            const arr = Object.entries(freq).sort((a, b) => order === "asc" ? a[1] - b[1] : b[1] - a[1]).slice(0, limit);
            return { result: arr.map(([w, n], i) => `${i + 1}. ${w}: ${n}`) };
        }
        case "wrap": {
            const width = parseInt(get("width", "80")), t = get("text");
            const words = t.split(/\s+/); const lines = []; let cur = "";
            for (const w of words) { if ((cur + " " + w).trim().length > width) { lines.push(cur.trim()); cur = w; } else cur += " " + w; }
            if (cur.trim()) lines.push(cur.trim());
            return { result: lines.join("\n") };
        }
        default:
            return { result: get("text") };
    }
}

function renderTextResult(data) {
    if (data === undefined || data === null) return "No result.";
    if (typeof data.result === "string") return data.result;
    if (Array.isArray(data.result)) {
        return data.result.map((item, i) => typeof item === "object" ? `${i + 1}. ${JSON.stringify(item)}` : `${i + 1}. ${item}`).join("\n").substring(0, 3000);
    }
    if (typeof data.result === "object" && data.result !== null) {
        return Object.entries(data.result).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join("\n").substring(0, 3000);
    }
    // No top-level "result" field (e.g. count, diff, palindrome, char-info,
    // text-stat) — just dump the whole data object's fields.
    return Object.entries(data).map(([k, v]) => {
        if (typeof v === "object" && v !== null) return `${k}: ${JSON.stringify(v)}`;
        return `${k}: ${v}`;
    }).join("\n").substring(0, 3000);
}

for (const [pattern, cfg] of Object.entries(COMMANDS)) {
    const endpoint = cfg.endpoint || pattern;
    mxd(
        { pattern, category: "tools", react: "📝", description: `Text utility: ${endpoint}` },
        async (from, Malvin, conText) => {
            const { q, reply, react } = conText;
            const parts = (q || "").split("|").map(s => s.trim());

            if (parts.filter(Boolean).length < cfg.required || !parts[0]) {
                await react("❌");
                return reply(`Usage: ${cfg.usage}`);
            }

            const params = {};
            cfg.params.forEach((paramName, i) => {
                if (parts[i] !== undefined && parts[i] !== "") params[paramName] = parts[i];
            });

            try {
                await react("⏳");
                const data = await callTextApi(endpoint, params, conText);
                const text = renderTextResult(data);
                await react("✅");
                return reply(text || "No result.");
            } catch (error) {
                console.error(`${endpoint} error:`, error.message);
                await react("❌");
                return reply(`Failed: ${error.message}`);
            }
        }
    );
}

// ==================== HELP ====================

mxd({ pattern: "texthelp", category: "tools", react: "📝", aliases: ["textmenu"], description: "Show all text utility commands" },
async (from, Malvin, conText) => {
    const { react, reply } = conText;
    await react("📝");
    const list = Object.entries(COMMANDS).map(([p]) => `.${p}`).join(", ");
    return reply(`📝 *TEXT UTILITIES*\n\n${list}\n\nUse "<usage>" per command, e.g. .case hello | upper\nArgs are separated by " | " in order.`);
});
