const { mxd } = require("../king");
const axios = require("axios");

const AX = axios.create({ timeout: 15000 });

// ==================== COUNTRY LOOKUP (restcountries.com, no key) ====================
mxd(
    {
        pattern: "country",
        category: "info",
        react: "🇺🇳",
        aliases: ["countryinfo", "cinfo", "countrycode", "ccode"],
        description: "Get detailed information about a country (name or ISO code)",
    },
    async (from, Malvin, conText) => {
        const { q, reply, react } = conText;

        if (!q) {
            await react("❌");
            return reply("Please provide a country name or ISO code\n\n*Examples:*\n.country Zimbabwe\n.country Japan\n.country JP");
        }

        try {
            await react("🔍");
            const query = q.trim();
            let c = null;
            // Try ISO code first if 2-3 letters, else name search
            if (/^[a-zA-Z]{2,3}$/.test(query)) {
                try {
                    const { data } = await AX.get(`https://restcountries.com/v3.1/alpha/${encodeURIComponent(query)}`);
                    c = Array.isArray(data) ? data[0] : data;
                } catch (_) { /* fall through to name search */ }
            }
            if (!c) {
                const { data } = await AX.get(`https://restcountries.com/v3.1/name/${encodeURIComponent(query)}?fullText=false`);
                c = Array.isArray(data) ? data[0] : data;
            }
            if (!c) {
                await react("❌");
                return reply("Country not found. Please check the name/code and try again.");
            }

            const name = c.name?.common || query;
            const region = c.region || "N/A";
            const capital = (c.capital && c.capital[0]) || "N/A";
            const population = c.population?.toLocaleString() || "N/A";
            const currency = c.currencies ? Object.entries(c.currencies).map(([code, v]) => `${v.name} (${code})`).join(", ") : "N/A";
            const languages = c.languages ? Object.values(c.languages).join(", ") : "N/A";
            const code = c.cca2 || c.cca3 || "N/A";
            const flagUrl = c.flags?.png || null;
            const maps = c.maps?.googleMaps || "";
            const wiki = `https://en.wikipedia.org/wiki/${encodeURIComponent(name)}`;

            const message = `🇺🇳 *${name}*\n📍 *Region:* ${region}\n🏠 *Capital:* ${capital}\n👥 *Population:* ${population}\n💰 *Currency:* ${currency}\n🗣️ *Languages:* ${languages}\n🔢 *Code:* ${code}\n\n🔗 ${maps || wiki}`;

            if (flagUrl) {
                await Malvin.sendMessage(from, { image: { url: flagUrl }, caption: message }, { quoted: conText.mek });
            } else {
                await reply(message);
            }

            await react("✅");
        } catch (error) {
            console.error("Country error:", error.message);
            await react("❌");
            reply("Country not found. Please check the name/code and try again.");
        }
    }
);

// ==================== IP LOOKUP (ip-api.com, no key) ====================
async function lookupIp(ip) {
    const url = ip
        ? `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,message,query,country,countryCode,regionName,city,zip,lat,lon,timezone,isp,org,as`
        : `http://ip-api.com/json/?fields=status,message,query,country,countryCode,regionName,city,zip,lat,lon,timezone,isp,org,as`;
    const { data } = await AX.get(url);
    if (data?.status !== "success") throw new Error(data?.message || "lookup failed");
    return data;
}

mxd(
    {
        pattern: "ip",
        category: "info",
        react: "🌐",
        aliases: ["ipinfo", "iplookup", "ipaddress"],
        description: "Get information about an IP address (omit for your own)",
    },
    async (from, Malvin, conText) => {
        const { q, reply, react } = conText;

        try {
            await react("🔍");
            const r = await lookupIp(q ? q.trim().split(/\s+/)[0] : null);

            const message = `🌐 *IP Lookup*\n\n📡 *IP:* ${r.query}\n📍 *Country:* ${r.country || "N/A"}\n🏙️ *Region:* ${r.regionName || "N/A"}\n🏠 *City:* ${r.city || "N/A"}\n📮 *Postal:* ${r.zip || "N/A"}\n🗺️ *Coordinates:* ${r.lat ?? "N/A"}, ${r.lon ?? "N/A"}\n⏰ *Timezone:* ${r.timezone || "N/A"}\n🔧 *ISP:* ${r.isp || "N/A"}\n🏢 *Org:* ${r.org || "N/A"}\n📡 *ASN:* ${r.as || "N/A"}`;

            if (r.lat != null && r.lon != null) {
                await reply(message);
                await reply(`🗺️ *Location on Maps:* https://www.google.com/maps?q=${r.lat},${r.lon}`);
            } else {
                await reply(message);
            }

            await react("✅");
        } catch (error) {
            console.error("IP lookup error:", error.message);
            await react("❌");
            reply("Failed to lookup IP address. Please try again.");
        }
    }
);

mxd(
    {
        pattern: "myip",
        category: "info",
        react: "🌐",
        aliases: ["myipaddress", "ipme"],
        description: "Get your own public IP address info",
    },
    async (from, Malvin, conText) => {
        const { reply, react } = conText;

        try {
            await react("🔍");
            const r = await lookupIp(null);
            await reply(`🌐 *Your IP Information*\n\n📡 *IP:* ${r.query}\n📍 *Country:* ${r.country || "N/A"}\n🏙️ *City:* ${r.city || "N/A"}\n🔧 *ISP:* ${r.isp || "N/A"}`);
            await react("✅");
        } catch (error) {
            console.error("MyIP error:", error.message);
            await react("❌");
            reply("Failed to get your IP address.");
        }
    }
);

// ==================== WEATHER (open-meteo, no key) ====================
const WEATHER_CODES = {
    0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Fog", 48: "Depositing rime fog",
    51: "Light drizzle", 53: "Moderate drizzle", 55: "Dense drizzle",
    61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain",
    71: "Slight snow", 73: "Moderate snow", 75: "Heavy snow",
    80: "Slight rain showers", 81: "Moderate rain showers", 82: "Violent rain showers",
    95: "Thunderstorm", 96: "Thunderstorm with slight hail", 99: "Thunderstorm with heavy hail",
};

mxd(
    {
        pattern: "weather",
        category: "info",
        react: "🌤️",
        aliases: ["weatherinfo", "climate", "temp"],
        description: "Get current weather and forecast for a city",
    },
    async (from, Malvin, conText) => {
        const { q, reply, react } = conText;

        if (!q) {
            await react("❌");
            return reply("Please provide a city name\n\n*Examples:*\n.weather Harare\n.weather London\n.weather New York");
        }

        try {
            await react("🔍");

            const { data: geoData } = await AX.get(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=en&format=json`);
            const place = geoData?.results?.[0];
            if (!place) {
                await react("❌");
                return reply("City not found. Please check the name and try again.");
            }

            const { data: w } = await AX.get(`https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,wind_speed_10m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code&timezone=auto&forecast_days=3`);

            const current = w.current;
            const daily = w.daily;
            const label = `${place.name}${place.admin1 ? `, ${place.admin1}` : ""}, ${place.country || ""}`.trim();

            let message = `🌤️ *Weather in ${label}*\n\n`;
            if (current) {
                message += `🌡️ *Temperature:* ${current.temperature_2m}°C\n💨 *Wind:* ${current.wind_speed_10m} km/h\n☁️ *Condition:* ${WEATHER_CODES[current.weather_code] || "Unknown"}\n`;
            }
            if (daily?.time?.length) {
                message += `\n📅 *3-Day Forecast*\n`;
                for (let i = 0; i < Math.min(3, daily.time.length); i++) {
                    message += `\n${daily.time[i]}\n   📈 High: ${daily.temperature_2m_max[i]}°C | 📉 Low: ${daily.temperature_2m_min[i]}°C\n   ☔ Precipitation: ${daily.precipitation_sum[i]}mm\n   ☁️ ${WEATHER_CODES[daily.weather_code[i]] || "Unknown"}`;
                }
            }

            await reply(message);
            await react("✅");
        } catch (error) {
            console.error("Weather error:", error.message);
            await react("❌");
            reply("Failed to get weather. Please try again.");
        }
    }
);

// ==================== FUN FACTS / ADVICE / QUOTES / JOKES (public, no key) ====================
mxd(
    { pattern: "advice", category: "info", react: "💡", aliases: [], description: "Get a random piece of advice" },
    async (from, Malvin, conText) => {
        const { reply, react } = conText;
        try {
            await react("💡");
            const { data } = await AX.get("https://api.adviceslip.com/advice");
            const advice = data?.slip?.advice;
            if (!advice) return reply("Failed to fetch advice.");
            await reply(`💡 *Advice*\n\n${advice}`);
            await react("✅");
        } catch (error) {
            await react("❌");
            reply("Failed to fetch advice. Please try again.");
        }
    }
);

mxd(
    { pattern: "fact", category: "info", react: "📚", aliases: [], description: "Get a random fact" },
    async (from, Malvin, conText) => {
        const { reply, react } = conText;
        try {
            await react("📚");
            const { data } = await AX.get("https://uselessfacts.jsph.pl/api/v2/facts/random?language=en");
            if (!data?.text) return reply("Failed to fetch a fact.");
            await reply(`📚 *Random Fact*\n\n${data.text}`);
            await react("✅");
        } catch (error) {
            await react("❌");
            reply("Failed to fetch a fact. Please try again.");
        }
    }
);

mxd(
    { pattern: "uselessfact", category: "info", react: "🤷", aliases: ["randomfact"], description: "Get a useless fact" },
    async (from, Malvin, conText) => {
        const { reply, react } = conText;
        try {
            await react("🤷");
            const { data } = await AX.get("https://uselessfacts.jsph.pl/api/v2/facts/random?language=en");
            if (!data?.text) return reply("Failed to fetch a useless fact.");
            await reply(`🤷 *Useless Fact*\n\n${data.text}`);
            await react("✅");
        } catch (error) {
            await react("❌");
            reply("Failed to fetch a useless fact. Please try again.");
        }
    }
);

mxd(
    { pattern: "joke", category: "info", react: "😂", aliases: [], description: "Get a random joke" },
    async (from, Malvin, conText) => {
        const { reply, react } = conText;
        try {
            await react("😂");
            try {
                const { data } = await AX.get("https://official-joke-api.appspot.com/random_joke");
                if (data?.setup) {
                    await reply(`😂 *Joke*\n\n${data.setup}\n\n${data.punchline}`);
                    await react("✅");
                    return;
                }
            } catch (_) { /* fallback below */ }
            const { data } = await AX.get("https://v2.jokeapi.dev/joke/Any?type=twopart&safe-mode");
            if (!data?.setup) return reply("Failed to fetch a joke.");
            await reply(`😂 *Joke*\n\n${data.setup}\n\n${data.delivery}`);
            await react("✅");
        } catch (error) {
            await react("❌");
            reply("Failed to fetch a joke. Please try again.");
        }
    }
);

mxd(
    { pattern: "quote", category: "info", react: "💬", aliases: [], description: "Get a random inspirational quote" },
    async (from, Malvin, conText) => {
        const { reply, react } = conText;
        try {
            await react("💬");
            const { data } = await AX.get("https://dummyjson.com/quotes/random");
            if (!data?.quote) return reply("Failed to fetch a quote.");
            await reply(`💬 *Quote*\n\n"${data.quote}"\n\n— ${data.author || "Unknown"}`);
            await react("✅");
        } catch (error) {
            await react("❌");
            reply("Failed to fetch a quote. Please try again.");
        }
    }
);

// ==================== DICTIONARY (dictionaryapi.dev, no key) ====================
mxd(
    { pattern: "define", category: "info", react: "📖", aliases: ["dictionary", "meaning"], description: "Look up a word's definition" },
    async (from, Malvin, conText) => {
        const { q, reply, react } = conText;
        if (!q) {
            await react("❌");
            return reply("Please provide a word\n\n*Example:* .define serendipity");
        }
        try {
            await react("🔍");
            const word = q.trim().split(/\s+/)[0];
            const { data } = await AX.get(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
            const entry = Array.isArray(data) ? data[0] : null;
            if (!entry?.meanings?.length) {
                await react("❌");
                return reply("Word not found in dictionary.");
            }
            let message = `📖 *${entry.word}*${entry.phonetic ? ` [${entry.phonetic}]` : ""}\n\n`;
            for (const m of entry.meanings.slice(0, 3)) {
                message += `*${m.partOfSpeech}*\n`;
                for (const def of (m.definitions || []).slice(0, 2)) {
                    message += `• ${def.definition}${def.example ? `\n   _"${def.example}"_` : ""}\n`;
                }
                message += "\n";
            }
            await reply(message.trim());
            await react("✅");
        } catch (error) {
            await react("❌");
            reply("Word not found in dictionary.");
        }
    }
);

// ==================== CURRENCY (open.er-api.com, no key) ====================
mxd(
    { pattern: "currency", category: "info", react: "💱", aliases: ["convert", "exchangerate"], description: "Convert between currencies" },
    async (from, Malvin, conText) => {
        const { q, reply, react } = conText;
        if (!q) {
            await react("❌");
            return reply("Please provide currencies\n\n*Example:* .currency USD IDR 100");
        }
        const parts = q.trim().split(/\s+/);
        const from_ = (parts[0] || "").toUpperCase();
        const to = (parts[1] || "").toUpperCase();
        const amount = parseFloat(parts[2] || "1");
        if (!/^[A-Z]{3}$/.test(from_) || !/^[A-Z]{3}$/.test(to)) {
            await react("❌");
            return reply("Please use valid 3-letter currency codes\n\n*Example:* .currency USD IDR 100");
        }
        try {
            await react("💱");
            const { data } = await AX.get(`https://open.er-api.com/v6/latest/${from_}`);
            const rate = data?.rates?.[to];
            if (!rate) {
                await react("❌");
                return reply("Failed to convert currency. Please check the currency codes.");
            }
            const converted = (amount * rate).toLocaleString(undefined, { maximumFractionDigits: 2 });
            await reply(`💱 *Currency Conversion*\n\n${amount} ${from_} = *${converted} ${to}*\n\n📊 Rate: 1 ${from_} = ${rate} ${to}\n🕐 Updated: ${data.time_last_update_utc || "N/A"}`);
            await react("✅");
        } catch (error) {
            await react("❌");
            reply("Failed to convert currency. Please try again.");
        }
    }
);

mxd(
    { pattern: "crypto", category: "info", react: "🪙", aliases: ["cryptoprice", "coinprice"], description: "Get cryptocurrency prices" },
    async (from, Malvin, conText) => {
        const { q, reply, react } = conText;
        const coin = q ? q.trim().split(/\s+/)[0].toLowerCase() : "bitcoin";
        const vs = ((q && q.trim().split(/\s+/)[1]) || "usd").toLowerCase();
        try {
            await react("🪙");
            const { data } = await AX.get(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coin)}&vs_currencies=${encodeURIComponent(vs)}&include_24hr_change=true`);
            const info = data?.[coin];
            const price = info?.[vs];
            if (price == null) {
                await react("❌");
                return reply("Failed to fetch crypto price. Check the coin ID (e.g. bitcoin, ethereum).");
            }
            const change = info[`${vs}_24h_change`];
            const vsUp = vs.toUpperCase();
            await reply(`🪙 *Crypto Prices (${vsUp})*\n\n*${coin}*\n💰 ${Number(price).toLocaleString()} ${vsUp}\n📈 24h: ${change != null ? change.toFixed(2) + "%" : "N/A"}`);
            await react("✅");
        } catch (error) {
            await react("❌");
            reply("Failed to fetch crypto price. Please try again.");
        }
    }
);

// ==================== TIME / DATE (worldtimeapi.org, no key) ====================
mxd(
    { pattern: "time", category: "info", react: "🕐", aliases: ["worldtime", "clock"], description: "Get current time in a timezone" },
    async (from, Malvin, conText) => {
        const { q, reply, react } = conText;
        const tz = (q || "UTC").trim() || "UTC";
        try {
            await react("🕐");
            const { data } = await AX.get(`https://worldtimeapi.org/api/timezone/${encodeURIComponent(tz)}`);
            if (!data?.datetime) {
                await react("❌");
                return reply("Invalid timezone. Example: Asia/Jakarta, America/New_York, Europe/London");
            }
            const d = new Date(data.datetime);
            const date = d.toLocaleDateString("en-GB", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
            const time = d.toLocaleTimeString("en-GB");
            await reply(`🕐 *Time in ${data.timezone}*\n\n📅 ${date} (${data.day_of_week ?? ""})\n⏰ ${time}`);
            await react("✅");
        } catch (error) {
            await react("❌");
            reply("Failed to fetch time. Please provide a valid IANA timezone.");
        }
    }
);

// Local moon-phase calculation (no API needed)
function moonPhaseLocal(date = new Date()) {
    const synodic = 29.53058867;
    const ref = Date.UTC(2000, 0, 6, 18, 14) / 86400000; // known new moon
    const days = date.getTime() / 86400000 - ref;
    const age = ((days % synodic) + synodic) % synodic;
    const illumination = (1 - Math.cos((age / synodic) * 2 * Math.PI)) / 2;
    const names = ["New Moon", "Waxing Crescent", "First Quarter", "Waxing Gibbous", "Full Moon", "Waning Gibbous", "Last Quarter", "Waning Crescent"];
    const idx = Math.floor(((age / synodic) * 8) + 0.5) % 8;
    return { name: names[idx], illumination, age: age.toFixed(1) };
}

mxd(
    { pattern: "moonphase", category: "info", react: "🌙", aliases: ["moon"], description: "Get the current moon phase" },
    async (from, Malvin, conText) => {
        const { q, reply, react } = conText;
        try {
            await react("🌙");
            let date = new Date();
            if (q && q.trim()) {
                const parsed = new Date(q.trim());
                if (isNaN(parsed)) {
                    await react("❌");
                    return reply("Invalid date. Use YYYY-MM-DD.");
                }
                date = parsed;
            }
            const m = moonPhaseLocal(date);
            const label = date.toISOString().slice(0, 10);
            await reply(`🌙 *Moon Phase — ${label}*\n\n🌗 *Phase:* ${m.name}\n💡 *Illumination:* ${(m.illumination * 100).toFixed(1)}%\n📅 *Age:* ${m.age} days`);
            await react("✅");
        } catch (error) {
            await react("❌");
            reply("Failed to fetch moon phase. Please try again.");
        }
    }
);

// ==================== SPACE (open-notify / wheretheiss.at, no key) ====================
mxd(
    { pattern: "iss", category: "info", react: "🛰️", aliases: ["isslocation", "spacestation"], description: "Get the ISS's current location" },
    async (from, Malvin, conText) => {
        const { reply, react } = conText;
        try {
            await react("🛰️");
            const { data } = await AX.get("https://api.wheretheiss.at/v1/satellites/25544");
            if (data?.latitude == null) {
                await react("❌");
                return reply("Failed to fetch ISS location.");
            }
            const maps = `https://www.google.com/maps?q=${data.latitude},${data.longitude}`;
            await reply(`🛰️ *ISS Location*\n\n📍 Lat: ${Number(data.latitude).toFixed(2)} | Lon: ${Number(data.longitude).toFixed(2)}\n📏 Altitude: ${Number(data.altitude).toFixed(1)} km\n💨 Velocity: ${Number(data.velocity).toFixed(0)} km/h\n👁️ Visibility: ${data.visibility || "N/A"}\n\n🗺️ ${maps}`);
            await react("✅");
        } catch (error) {
            await react("❌");
            reply("Failed to fetch ISS location. Please try again.");
        }
    }
);

mxd(
    { pattern: "astronauts", category: "info", react: "👨‍🚀", aliases: ["spacepeople", "whoisinspace"], description: "See who's currently in space" },
    async (from, Malvin, conText) => {
        const { reply, react } = conText;
        try {
            await react("👨‍🚀");
            const { data } = await AX.get("http://api.open-notify.org/astros.json");
            if (!data?.people?.length) {
                await react("❌");
                return reply("Failed to fetch astronaut data.");
            }
            const list = data.people.slice(0, 15).map((p, i) => `${i + 1}. ${p.name} (${p.craft})`).join("\n");
            await reply(`👨‍🚀 *People Currently in Space*\n\n👥 Total: ${data.number}\n\n${list}`);
            await react("✅");
        } catch (error) {
            await react("❌");
            reply("Failed to fetch astronaut data. Please try again.");
        }
    }
);

// ==================== HOLIDAYS (date.nager.at, no key) & UNIVERSITY (hipolabs, no key) ====================
mxd(
    { pattern: "holidays", category: "info", react: "🎉", aliases: ["publicholidays"], description: "Get public holidays for a country" },
    async (from, Malvin, conText) => {
        const { q, reply, react } = conText;
        if (!q) {
            await react("❌");
            return reply("Please provide a 2-letter country code\n\n*Example:* .holidays US 2025");
        }
        const parts = q.trim().split(/\s+/);
        const country = parts[0].toUpperCase();
        const year = parts[1] || new Date().getFullYear();
        if (!/^[A-Z]{2}$/.test(country)) {
            await react("❌");
            return reply("Country code must be 2 letters (e.g. US, GB, ID)");
        }
        try {
            await react("🎉");
            const { data } = await AX.get(`https://date.nager.at/api/v3/publicholidays/${year}/${country}`);
            if (!Array.isArray(data) || !data.length) {
                await react("❌");
                return reply("No holidays found for that country/year.");
            }
            const list = data.slice(0, 20).map(h => `📅 ${h.date} — *${h.localName}*${h.name !== h.localName ? ` (${h.name})` : ""}`).join("\n");
            await reply(`🎉 *Public Holidays — ${country} ${year}*\n📊 Total: ${data.length}\n\n${list}`);
            await react("✅");
        } catch (error) {
            await react("❌");
            reply("Failed to fetch holidays. Please try again.");
        }
    }
);

mxd(
    { pattern: "university", category: "info", react: "🎓", aliases: ["uni", "universitysearch"], description: "Search universities by name or country" },
    async (from, Malvin, conText) => {
        const { q, reply, react } = conText;
        if (!q) {
            await react("❌");
            return reply("Please provide a university or country name\n\n*Example:* .university harvard");
        }
        try {
            await react("🎓");
            const { data } = await AX.get(`http://universities.hipolabs.com/search?name=${encodeURIComponent(q)}`);
            if (!Array.isArray(data) || !data.length) {
                await react("❌");
                return reply("No universities found.");
            }
            const list = data.slice(0, 10).map((u, i) => `${i + 1}. *${u.name}*\n   🌍 ${u.country}\n   🔗 ${(u.web_pages && u.web_pages[0]) || "N/A"}`).join("\n\n");
            await reply(`🎓 *University Search: ${q}*\n📊 Found: ${data.length}\n\n${list}`);
            await react("✅");
        } catch (error) {
            await react("❌");
            reply("Failed to search universities. Please try again.");
        }
    }
);

// ==================== QR CODE (qrserver, no key) & AVATAR (dicebear, no key) ====================
mxd(
    { pattern: "qr", category: "info", react: "🔳", aliases: ["qrcode"], description: "Generate a QR code" },
    async (from, Malvin, conText) => {
        const { q, reply, react, mek } = conText;
        if (!q) {
            await react("❌");
            return reply("Please provide text/URL to encode\n\n*Example:* .qr https://example.com");
        }
        try {
            await react("🔳");
            const url = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(q)}`;
            await Malvin.sendMessage(from, { image: { url }, caption: `🔳 *QR Code*\n\n${q}` }, { quoted: mek });
            await react("✅");
        } catch (error) {
            await react("❌");
            reply("Failed to generate QR code. Please try again.");
        }
    }
);

mxd(
    { pattern: "avatar", category: "info", react: "🧑‍🎨", aliases: ["randomavatar", "genavatar"], description: "Generate a random or seeded avatar" },
    async (from, Malvin, conText) => {
        const { q, react, mek } = conText;
        const seed = q ? q.trim().split(/\s+/)[0] : Math.random().toString(36).slice(2, 10);
        try {
            await react("🧑‍🎨");
            const url = `https://api.dicebear.com/9.x/adventurer/png?seed=${encodeURIComponent(seed)}`;
            await Malvin.sendMessage(from, { image: { url }, caption: `🧑‍🎨 *Avatar*\n\n🌱 Seed: ${seed}` }, { quoted: mek });
            await react("✅");
        } catch (error) {
            await react("❌");
        }
    }
);

// ==================== ANIMAL FACTS (no key) ====================
mxd(
    { pattern: "dogfacts", category: "info", react: "🐶", aliases: ["dogfact"], description: "Get random dog facts" },
    async (from, Malvin, conText) => {
        const { q, reply, react } = conText;
        const count = q ? Math.min(5, parseInt(q) || 1) : 1;
        try {
            await react("🐶");
            const { data } = await AX.get(`https://dogapi.dog/api/v2/facts?limit=${count}`);
            const facts = (data?.data || []).map(d => d?.attributes?.body).filter(Boolean);
            if (!facts.length) {
                await react("❌");
                return reply("Failed to fetch dog facts.");
            }
            await reply(`🐶 *Dog Facts*\n\n${facts.map((f, i) => `${i + 1}. ${f}`).join("\n\n")}`);
            await react("✅");
        } catch (error) {
            await react("❌");
            reply("Failed to fetch dog facts. Please try again.");
        }
    }
);

mxd(
    { pattern: "catfacts", category: "info", react: "🐱", aliases: ["catfact"], description: "Get random cat facts" },
    async (from, Malvin, conText) => {
        const { q, reply, react } = conText;
        const count = q ? Math.min(5, parseInt(q) || 1) : 1;
        try {
            await react("🐱");
            if (count > 1) {
                const { data } = await AX.get(`https://catfact.ninja/facts?limit=${count}&max_length=300`);
                const facts = (data?.data || []).map(d => d?.fact).filter(Boolean);
                if (!facts.length) {
                    await react("❌");
                    return reply("Failed to fetch cat facts.");
                }
                await reply(`🐱 *Cat Facts*\n\n${facts.map((f, i) => `${i + 1}. ${f}`).join("\n\n")}`);
            } else {
                const { data } = await AX.get("https://catfact.ninja/fact?max_length=300");
                if (!data?.fact) {
                    await react("❌");
                    return reply("Failed to fetch cat facts.");
                }
                await reply(`🐱 *Cat Fact*\n\n${data.fact}`);
            }
            await react("✅");
        } catch (error) {
            await react("❌");
            reply("Failed to fetch cat facts. Please try again.");
        }
    }
);

// ==================== ZODIAC (local) ====================
function zodiacLocal(month, day) {
    const signs = [
        ["Capricorn", "♑", "Earth", "Dec 22 – Jan 19"], ["Aquarius", "♒", "Air", "Jan 20 – Feb 18"],
        ["Pisces", "♓", "Water", "Feb 19 – Mar 20"], ["Aries", "♈", "Fire", "Mar 21 – Apr 19"],
        ["Taurus", "♉", "Earth", "Apr 20 – May 20"], ["Gemini", "♊", "Air", "May 21 – Jun 20"],
        ["Cancer", "♋", "Water", "Jun 21 – Jul 22"], ["Leo", "♌", "Fire", "Jul 23 – Aug 22"],
        ["Virgo", "♍", "Earth", "Aug 23 – Sep 22"], ["Libra", "♎", "Air", "Sep 23 – Oct 22"],
        ["Scorpio", "♏", "Water", "Oct 23 – Nov 21"], ["Sagittarius", "♐", "Fire", "Nov 22 – Dec 21"],
    ];
    const cutoffs = [19, 18, 20, 19, 20, 20, 22, 22, 22, 22, 21, 21];
    const idx = day <= cutoffs[month - 1] ? (month - 1 + 11) % 12 + 0 : month % 12;
    // Map: month 1..12 -> sign index
    const order = [0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    void order;
    const table = [
        day <= 19 ? 0 : 1, day <= 18 ? 1 : 2, day <= 20 ? 2 : 3, day <= 19 ? 3 : 4,
        day <= 20 ? 4 : 5, day <= 20 ? 5 : 6, day <= 22 ? 6 : 7, day <= 22 ? 7 : 8,
        day <= 22 ? 8 : 9, day <= 22 ? 9 : 10, day <= 21 ? 10 : 11, day <= 21 ? 11 : 0,
    ];
    const s = signs[table[month - 1]];
    return { sign: s[0], symbol: s[1], element: s[2], date_range: s[3] };
}

mxd(
    { pattern: "zodiac", category: "info", react: "♈", aliases: ["horoscope"], description: "Get your zodiac sign from birth month/day" },
    async (from, Malvin, conText) => {
        const { q, reply, react } = conText;
        if (!q) {
            await react("❌");
            return reply("Please provide month and day\n\n*Example:* .zodiac 7 15");
        }
        const [month, day] = q.trim().split(/\s+/).map(Number);
        if (!month || !day || month < 1 || month > 12 || day < 1 || day > 31) {
            await react("❌");
            return reply("Please provide a valid month and day\n\n*Example:* .zodiac 7 15");
        }
        try {
            await react("♈");
            const z = zodiacLocal(month, day);
            await reply(`♈ *Zodiac Sign*\n\n🌟 *Sign:* ${z.sign} ${z.symbol}\n🔥 *Element:* ${z.element}\n📅 *Date Range:* ${z.date_range}`);
            await react("✅");
        } catch (error) {
            await react("❌");
            reply("Failed to fetch zodiac sign. Please try again.");
        }
    }
);

function chineseZodiacLocal(year) {
    const animals = ["Monkey", "Rooster", "Dog", "Pig", "Rat", "Ox", "Tiger", "Rabbit", "Dragon", "Snake", "Horse", "Goat"];
    const elements = ["Metal", "Metal", "Water", "Water", "Wood", "Wood", "Fire", "Fire", "Earth", "Earth"];
    return { animal: animals[year % 12], element: elements[year % 10] };
}

mxd(
    { pattern: "chinesezodiac", category: "info", react: "🐉", aliases: ["cnzodiac"], description: "Get your Chinese zodiac from birth year" },
    async (from, Malvin, conText) => {
        const { q, reply, react } = conText;
        const year = parseInt(q);
        if (!year || year < 1900 || year > 2100) {
            await react("❌");
            return reply("Please provide a valid birth year (1900-2100)\n\n*Example:* .chinesezodiac 1995");
        }
        try {
            await react("🐉");
            const z = chineseZodiacLocal(year);
            await reply(`🐉 *Chinese Zodiac — ${year}*\n\n🐾 *Animal:* ${z.animal}\n⚡ *Element:* ${z.element}`);
            await react("✅");
        } catch (error) {
            await react("❌");
            reply("Failed to fetch Chinese zodiac. Please try again.");
        }
    }
);

// ==================== AGE CALCULATOR (local) ====================
mxd(
    { pattern: "age", category: "info", react: "🎂", aliases: ["agecalc"], description: "Calculate age from birth date" },
    async (from, Malvin, conText) => {
        const { q, reply, react } = conText;
        if (!q) {
            await react("❌");
            return reply("Please provide a birth date (YYYY-MM-DD)\n\n*Example:* .age 1995-05-15");
        }
        const birthStr = q.trim().split(/\s+/)[0];
        const birth = new Date(birthStr + "T00:00:00Z");
        if (isNaN(birth)) {
            await react("❌");
            return reply("Invalid date format. Please use YYYY-MM-DD.");
        }
        try {
            await react("🎂");
            const now = new Date();
            let years = now.getUTCFullYear() - birth.getUTCFullYear();
            let months = now.getUTCMonth() - birth.getUTCMonth();
            let days = now.getUTCDate() - birth.getUTCDate();
            if (days < 0) { months--; days += new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).getUTCDate(); }
            if (months < 0) { years--; months += 12; }
            const totalDays = Math.floor((now - birth) / 86400000);
            const totalWeeks = Math.floor(totalDays / 7);
            const next = new Date(Date.UTC(now.getUTCFullYear(), birth.getUTCMonth(), birth.getUTCDate()));
            if (next <= now) next.setUTCFullYear(next.getUTCFullYear() + 1);
            const daysUntil = Math.ceil((next - now) / 86400000);
            await reply(`🎂 *Age Calculator*\n\n🎈 *Age:* ${years} years, ${months} months, ${days} days\n📊 *Total Days:* ${totalDays.toLocaleString()}\n📆 *Total Weeks:* ${totalWeeks.toLocaleString()}\n🎉 *Next Birthday:* ${next.toISOString().slice(0, 10)} (in ${daysUntil} days)`);
            await react("✅");
        } catch (error) {
            await react("❌");
            reply("Failed to calculate age. Please try again.");
        }
    }
);

// ==================== BORED (bored-api, no key) ====================
mxd(
    { pattern: "bored", category: "info", react: "🎲", aliases: ["activity", "imbored"], description: "Get a random activity idea" },
    async (from, Malvin, conText) => {
        const { q, reply, react } = conText;
        try {
            await react("🎲");
            const url = q && q.trim()
                ? `https://bored-api.appbrewery.com/filter?type=${encodeURIComponent(q.trim().toLowerCase())}`
                : `https://bored-api.appbrewery.com/random`;
            const { data } = await AX.get(url);
            const a = Array.isArray(data) ? data[Math.floor(Math.random() * data.length)] : data;
            if (!a?.activity) {
                await react("❌");
                return reply("Failed to fetch an activity.");
            }
            await reply(`🎲 *Bored? Try this:*\n\n${a.activity}\n\n📂 Type: ${a.type || "N/A"}`);
            await react("✅");
        } catch (error) {
            await react("❌");
            reply("Failed to fetch an activity. Please try again.");
        }
    }
);

// ==================== DEVELOPER TOOLS ====================
mxd(
    { pattern: "npm", category: "info", react: "📦", aliases: ["npmsearch", "npmpackage"], description: "Look up an npm package" },
    async (from, Malvin, conText) => {
        const { q, reply, react } = conText;
        if (!q) {
            await react("❌");
            return reply("Please provide a package name\n\n*Example:* .npm axios");
        }
        try {
            await react("🔍");
            const name = q.trim().split(/\s+/)[0];
            const { data } = await AX.get(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`);
            if (!data?.name) {
                await react("❌");
                return reply("Package not found.");
            }
            await reply(`📦 *${data.name}*\n\n📝 ${data.description || "No description"}\n🏷️ *Version:* ${data.version}\n📜 *License:* ${data.license || "N/A"}\n🔗 https://www.npmjs.com/package/${data.name}`);
            await react("✅");
        } catch (error) {
            await react("❌");
            reply("Failed to look up package. Please try again.");
        }
    }
);

const HTTP_STATUS = {
    100: ["Continue", "Interim response, continue the request."], 200: ["OK", "Request succeeded."],
    201: ["Created", "A new resource was created."], 204: ["No Content", "Success, nothing to return."],
    301: ["Moved Permanently", "Resource moved to a new URL."], 302: ["Found", "Temporary redirect."],
    304: ["Not Modified", "Cached version is still valid."], 400: ["Bad Request", "Server cannot process the request."],
    401: ["Unauthorized", "Authentication required."], 403: ["Forbidden", "Server refuses to authorize."],
    404: ["Not Found", "Resource not found."], 405: ["Method Not Allowed", "HTTP method not supported."],
    408: ["Request Timeout", "Server timed out."], 409: ["Conflict", "Request conflicts with current state."],
    410: ["Gone", "Resource permanently removed."], 418: ["I'm a teapot", "April Fools joke from RFC 2324."],
    422: ["Unprocessable Entity", "Semantic errors in the request."], 429: ["Too Many Requests", "Rate limited."],
    500: ["Internal Server Error", "Generic server error."], 501: ["Not Implemented", "Server lacks the functionality."],
    502: ["Bad Gateway", "Invalid response from upstream."], 503: ["Service Unavailable", "Server overloaded or down."],
    504: ["Gateway Timeout", "Upstream server timed out."],
};

mxd(
    { pattern: "httpstatus", category: "info", react: "🔢", aliases: ["httpcode"], description: "Look up an HTTP status code" },
    async (from, Malvin, conText) => {
        const { q, reply, react } = conText;
        if (!q) {
            await react("❌");
            return reply("Please provide an HTTP status code\n\n*Example:* .httpstatus 404");
        }
        const code = parseInt(q.trim());
        const s = HTTP_STATUS[code];
        await react("🔢");
        if (!s) return reply("Status code not found.");
        await reply(`🔢 *HTTP ${code}*\n\n📛 ${s[0]}\n📝 ${s[1]}`);
        await react("✅");
    }
);

// ==================== POKEMON (pokeapi.co, no key) ====================
mxd(
    { pattern: "pokemon", category: "info", react: "⚡", aliases: ["pokedex"], description: "Get info about a Pokemon" },
    async (from, Malvin, conText) => {
        const { q, reply, react, mek } = conText;
        if (!q) {
            await react("❌");
            return reply("Please provide a Pokemon name or ID\n\n*Example:* .pokemon pikachu");
        }
        try {
            await react("🔍");
            const { data: p } = await AX.get(`https://pokeapi.co/api/v2/pokemon/${encodeURIComponent(q.trim().toLowerCase())}`);
            if (!p?.name) {
                await react("❌");
                return reply("Pokemon not found.");
            }
            const message = `⚡ *#${p.id} ${p.name.toUpperCase()}*\n\n📏 *Height:* ${(p.height / 10)}m\n⚖️ *Weight:* ${(p.weight / 10)}kg\n✨ *Base XP:* ${p.base_experience}\n🏷️ *Types:* ${p.types.map(t => t.type.name).join(", ")}\n\n📊 *Stats*\n${p.stats.map(s => `• ${s.stat.name}: ${s.base_stat}`).join("\n")}\n\n✨ *Abilities:* ${p.abilities.map(a => a.ability.name + (a.is_hidden ? " (hidden)" : "")).join(", ")}`;
            const img = p.sprites?.other?.["official-artwork"]?.front_default || p.sprites?.front_default;
            if (img) {
                await Malvin.sendMessage(from, { image: { url: img }, caption: message }, { quoted: mek });
            } else {
                await reply(message);
            }
            await react("✅");
        } catch (error) {
            await react("❌");
            reply("Failed to fetch Pokemon. Please try again.");
        }
    }
);

// ==================== XKCD COMIC (xkcd.com, no key) ====================
mxd(
    { pattern: "xkcd", category: "info", react: "😄", aliases: ["comic"], description: "Get an xkcd comic (latest, by ID, or random)" },
    async (from, Malvin, conText) => {
        const { q, react, mek } = conText;
        try {
            await react("😄");
            let id = null;
            if (q && q.trim().toLowerCase() === "random") {
                const { data: latest } = await AX.get("https://xkcd.com/info.0.json");
                id = Math.floor(Math.random() * (latest?.num || 3000)) + 1;
            } else if (q && /^\d+$/.test(q.trim())) {
                id = q.trim();
            }
            const url = id ? `https://xkcd.com/${id}/info.0.json` : "https://xkcd.com/info.0.json";
            const { data: c } = await AX.get(url);
            if (!c?.img) {
                await react("❌");
                return;
            }
            await Malvin.sendMessage(from, { image: { url: c.img }, caption: `😄 *xkcd #${c.num}: ${c.title}*\n\n_${c.alt}_` }, { quoted: mek });
            await react("✅");
        } catch (error) {
            await react("❌");
        }
    }
);

// ==================== TECH / NEWS (Hacker News official API, no key) ====================
mxd(
    { pattern: "hackernews", category: "info", react: "📰", aliases: ["hn", "hackernewstop"], description: "Get top Hacker News stories" },
    async (from, Malvin, conText) => {
        const { q, reply, react } = conText;
        const limit = q ? Math.min(15, parseInt(q) || 5) : 5;
        try {
            await react("📰");
            const { data: ids } = await AX.get("https://hacker-news.firebaseio.com/v0/topstories.json");
            if (!Array.isArray(ids)?.length && !ids?.length) {
                await react("❌");
                return reply("Failed to fetch Hacker News stories.");
            }
            const stories = [];
            for (const id of ids.slice(0, limit)) {
                try {
                    const { data: s } = await AX.get(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
                    if (s?.title) stories.push(s);
                } catch (_) {}
            }
            if (!stories.length) {
                await react("❌");
                return reply("Failed to fetch Hacker News stories.");
            }
            const list = stories.map((s, i) => `${i + 1}. *${s.title}*\n   📈 ${s.score ?? 0} pts | 💬 ${s.descendants ?? 0} comments\n   🔗 https://news.ycombinator.com/item?id=${s.id}`).join("\n\n");
            await reply(`📰 *Hacker News — Top Stories*\n\n${list}`);
            await react("✅");
        } catch (error) {
            await react("❌");
            reply("Failed to fetch Hacker News. Please try again.");
        }
    }
);

// ==================== NAME-BASED DEMOGRAPHICS (agify/genderize/nationalize, no key) ====================
mxd(
    { pattern: "namestats", category: "info", react: "🔮", aliases: ["nameinfo", "predictname"], description: "Predict age, gender & nationality from a first name" },
    async (from, Malvin, conText) => {
        const { q, reply, react } = conText;
        if (!q) {
            await react("❌");
            return reply("Please provide a first name\n\n*Example:* .namestats alex");
        }
        const name = q.trim().split(/\s+/)[0];
        try {
            await react("🔮");
            const [ageRes, genderRes, natRes] = await Promise.all([
                AX.get(`https://api.agify.io?name=${encodeURIComponent(name)}`).catch(() => null),
                AX.get(`https://api.genderize.io?name=${encodeURIComponent(name)}`).catch(() => null),
                AX.get(`https://api.nationalize.io?name=${encodeURIComponent(name)}`).catch(() => null),
            ]);

            const age = ageRes?.data;
            const gender = genderRes?.data;
            const nat = natRes?.data;

            let message = `🔮 *Name Analysis: ${name}*\n\n`;
            if (age?.age) message += `🎂 *Predicted Age:* ${age.age} (based on ${age.count?.toLocaleString() || 0} records)\n`;
            if (gender?.gender) message += `⚧️ *Predicted Gender:* ${gender.gender} (${((gender.probability || 0) * 100).toFixed(0)}% confidence)\n`;
            if (nat?.country?.length) {
                message += `\n🌍 *Likely Nationalities:*\n${nat.country.slice(0, 5).map(c => `• ${c.country_id}: ${(c.probability * 100).toFixed(1)}%`).join("\n")}`;
            }

            await reply(message);
            await react("✅");
        } catch (error) {
            await react("❌");
            reply("Failed to analyze name. Please try again.");
        }
    }
);

// ==================== INFO HELP COMMAND ====================
mxd(
    {
        pattern: "infohelp",
        category: "info",
        react: "ℹ️",
        aliases: ["infocmds", "infocommands"],
        description: "Show all info commands",
    },
    async (from, Malvin, conText) => {
        const { reply, react } = conText;
        await react("ℹ️");

        const message = `╭══〘〘 *INFO COMMANDS* 〙〙═⊷
│↠🇺🇳 .country <name/code>
│↠🌐 .ip [address]
│↠🌐 .myip
│↠🌤️ .weather <city>
╰═════════════════⊷

━━ *FUN* ━━
│↠💡 .advice
│↠📚 .fact
│↠🤷 .uselessfact
│↠😂 .joke
│↠💬 .quote
│↠🐶 .dogfacts [count]
│↠🐱 .catfacts [count]
│↠😄 .xkcd [id/random]
╰═════════════════⊷

━━ *LANGUAGE & FINANCE* ━━
│↠📖 .define <word>
│↠💱 .currency <from> <to> [amount]
│↠🪙 .crypto [coin] [vs]
╰═════════════════⊷

━━ *TIME & SPACE* ━━
│↠🕐 .time [timezone]
│↠🌙 .moonphase [date]
│↠🛰️ .iss
│↠👨‍🚀 .astronauts
╰═════════════════⊷

━━ *LOOKUP TOOLS* ━━
│↠🎉 .holidays <country> [year]
│↠🎓 .university <name>
│↠🔳 .qr <text>
│↠🧑‍🎨 .avatar [seed]
│↠📦 .npm <package>
│↠🔢 .httpstatus <code>
╰═════════════════⊷

━━ *FUN CALCULATORS* ━━
│↠♈ .zodiac <month> <day>
│↠🐉 .chinesezodiac <year>
│↠🎂 .age <birthdate>
│↠🎲 .bored [type]
│↠⚡ .pokemon <name>
│↠🔮 .namestats <name>
╰═════════════════⊷

━━ *NEWS* ━━
│↠📰 .hackernews [limit]
╰═════════════════⊷`;

        await reply(message);
        await react("✅");
    }
);
