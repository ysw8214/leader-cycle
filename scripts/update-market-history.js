const fs = require("fs");
const path = require("path");

const API_KEY = process.env.KRX_API_KEY;

if (!API_KEY) {
  console.error("KRX_API_KEY가 없습니다.");
  process.exit(1);
}

const KOSPI_URL =
  "https://data-dbg.krx.co.kr/svc/apis/sto/stk_bydd_trd";

const KOSDAQ_URL =
  "https://data-dbg.krx.co.kr/svc/apis/sto/ksq_bydd_trd";

const OUTPUT_FILE = path.join(
  process.cwd(),
  "data",
  "market-history.json"
);

const CALENDAR_DAYS = 170;
const MAX_TRADING_DAYS = 105;

function num(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return 0;
  }

  const n = Number(
    String(value)
      .replace(/,/g, "")
      .trim()
  );

  return Number.isFinite(n) ? n : 0;
}

function normalizeCode(value) {
  const raw = String(value || "").trim();

  if (/^\d{6}$/.test(raw)) {
    return raw;
  }

  const match = raw.match(/(\d{6})/);

  return match ? match[1] : "";
}

function formatDate(date) {
  const y = date.getFullYear();

  const m = String(
    date.getMonth() + 1
  ).padStart(2, "0");

  const d = String(
    date.getDate()
  ).padStart(2, "0");

  return `${y}${m}${d}`;
}

function sleep(ms) {
  return new Promise(resolve =>
    setTimeout(resolve, ms)
  );
}

function getKoreaDate() {
  const formatter =
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });

  const parts =
    formatter.formatToParts(new Date());

  const values = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }

  return new Date(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day)
  );
}

async function fetchMarket(date, market) {
  const endpoint =
    market === "KOSDAQ"
      ? KOSDAQ_URL
      : KOSPI_URL;

  const url =
    `${endpoint}?basDd=${date}`;

  for (
    let attempt = 1;
    attempt <= 3;
    attempt++
  ) {
    try {
      const controller =
        new AbortController();

      const timer = setTimeout(
        () => controller.abort(),
        15000
      );

      let response;

      try {
        response = await fetch(url, {
          headers: {
            AUTH_KEY: API_KEY,
            Accept: "application/json"
          },
          signal: controller.signal
        });
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}`
        );
      }

      const json =
        await response.json();

      const rows =
        Array.isArray(json?.OutBlock_1)
          ? json.OutBlock_1
          : [];

      return {
        ok: true,
        market,
        date,
        rows
      };

    } catch (error) {
      console.log(
        `${date} ${market} attempt ${attempt} failed`,
        error.message
      );

      if (attempt < 3) {
        await sleep(attempt * 1000);
      }
    }
  }

  return {
    ok: false,
    market,
    date,
    rows: []
  };
}

function convertRow(row, market, date) {
  const code = normalizeCode(
    row.ISU_SRT_CD ||
    row.SRT_CD ||
    row.ISU_CD
  );

  if (!code) {
    return null;
  }

  const close = num(
    row.TDD_CLSPRC
  );

  if (close <= 0) {
    return null;
  }

  return {
    date: String(
      row.BAS_DD || date
    ),

    code,

    name: String(
      row.ISU_ABBRV ||
      row.ISU_NM ||
      ""
    ).trim(),

    market,

    open: num(row.TDD_OPNPRC),
    high: num(row.TDD_HGPRC),
    low: num(row.TDD_LWPRC),
    close,

    changeRate:
      num(row.FLUC_RT),

    volume:
      num(row.ACC_TRDVOL),

    tradingValue:
      num(row.ACC_TRDVAL),

    marketCap:
      num(row.MKTCAP)
  };
}

function loadExisting() {
  try {
    if (!fs.existsSync(OUTPUT_FILE)) {
      return null;
    }

    return JSON.parse(
      fs.readFileSync(
        OUTPUT_FILE,
        "utf8"
      )
    );

  } catch (error) {
    console.log(
      "기존 history 로드 실패:",
      error.message
    );

    return null;
  }
}

async function main() {
  console.log(
    "LEADER CYCLE HISTORY UPDATE START"
  );

  const existing =
    loadExisting();

  const stockMap =
    new Map();

  if (
    existing?.stocks &&
    typeof existing.stocks === "object"
  ) {
    for (
      const [code, stock] of
      Object.entries(existing.stocks)
    ) {
      stockMap.set(code, {
        code,

        name:
          stock.name || "",

        market:
          stock.market || "",

        history:
          Array.isArray(stock.history)
            ? stock.history
            : []
      });
    }
  }

  const baseDate =
    getKoreaDate();

  const candidateDates = [];

  for (
    let i = 0;
    i < CALENDAR_DAYS;
    i++
  ) {
    const date =
      new Date(baseDate);

    date.setDate(
      baseDate.getDate() - i
    );

    const weekday =
      date.getDay();

    if (
      weekday === 0 ||
      weekday === 6
    ) {
      continue;
    }

    candidateDates.push(
      formatDate(date)
    );
  }

  let tradingDays = 0;
  let newestTradingDate = null;

  for (
    const date of candidateDates
  ) {
    if (
      tradingDays >=
      MAX_TRADING_DAYS
    ) {
      break;
    }

    console.log(
      `Fetching ${date}`
    );

    const [kospi, kosdaq] =
      await Promise.all([
        fetchMarket(
          date,
          "KOSPI"
        ),

        fetchMarket(
          date,
          "KOSDAQ"
        )
      ]);

    const totalRows =
      kospi.rows.length +
      kosdaq.rows.length;

    if (totalRows === 0) {
      continue;
    }

    if (!newestTradingDate) {
      newestTradingDate = date;
    }

    tradingDays++;

    for (
      const result of
      [kospi, kosdaq]
    ) {
      if (!result.ok) {
        continue;
      }

      for (
        const rawRow of result.rows
      ) {
        const row =
          convertRow(
            rawRow,
            result.market,
            date
          );

        if (!row) {
          continue;
        }

        let stock =
          stockMap.get(row.code);

        if (!stock) {
          stock = {
            code: row.code,
            name: row.name,
            market: row.market,
            history: []
          };

          stockMap.set(
            row.code,
            stock
          );
        }

        stock.name =
          row.name || stock.name;

        stock.market =
          row.market || stock.market;

        const index =
          stock.history.findIndex(
            item =>
              item.date === row.date
          );

        if (index >= 0) {
          stock.history[index] =
            row;
        } else {
          stock.history.push(row);
        }
      }
    }

    await sleep(150);
  }

  const outputStocks = {};

  for (
    const [code, stock] of
    stockMap.entries()
  ) {
    const history =
      stock.history
        .filter(
          row =>
            row &&
            row.date &&
            num(row.close) > 0
        )
        .sort(
          (a, b) =>
            b.date.localeCompare(
              a.date
            )
        )
        .slice(
          0,
          MAX_TRADING_DAYS
        );

    if (!history.length) {
      continue;
    }

    outputStocks[code] = {
      code,
      name: stock.name,
      market: stock.market,
      history
    };
  }

  const output = {
    ok: true,

    version:
      "LEADER_CYCLE_STATIC_HISTORY_V1",

    updatedAt:
      new Date().toISOString(),

    latestTradingDate:
      newestTradingDate,

    tradingDaysCollected:
      tradingDays,

    stockCount:
      Object.keys(
        outputStocks
      ).length,

    stocks:
      outputStocks
  };

  fs.mkdirSync(
    path.dirname(OUTPUT_FILE),
    {
      recursive: true
    }
  );

  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify(output),
    "utf8"
  );

  const stat =
    fs.statSync(OUTPUT_FILE);

  console.log(
    "UPDATE COMPLETE"
  );

  console.log(
    "latestTradingDate:",
    newestTradingDate
  );

  console.log(
    "tradingDays:",
    tradingDays
  );

  console.log(
    "stocks:",
    Object.keys(
      outputStocks
    ).length
  );

  console.log(
    "fileMB:",
    (
      stat.size /
      1024 /
      1024
    ).toFixed(2)
  );
}

main().catch(error => {
  console.error(
    "HISTORY UPDATE FAILED",
    error
  );

  process.exit(1);
});
