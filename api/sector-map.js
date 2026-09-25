/* =========================================================
   LEADER CYCLE - SECTOR MAP V3

   역할
   ---------------------------------------------------------
   1. data/sector-master.js의 검증된 Primary Sector 사용
   2. 마스터에 없는 종목은 안전한 이름 추론
   3. 애매한 종목은 UNKNOWN
   4. sector-scan.js와 기존 인터페이스 완전 호환

   우선순위
   ---------------------------------------------------------
   SECTOR MASTER > SAFE NAME INFERENCE > UNKNOWN
========================================================= */


/* =========================================================
   IMPORT PRIMARY SECTOR MASTER

   sector-map.js 위치: /api
   sector-master.js 위치: /data
========================================================= */

const {
  SECTOR_MASTER
} = require("../data/sector-master");


/* =========================================================
   STANDARD SECTORS
========================================================= */

const SECTORS = Object.freeze({

  SEMICONDUCTOR: {
    id: "SEMICONDUCTOR",
    name: "반도체"
  },

  DISPLAY: {
    id: "DISPLAY",
    name: "디스플레이"
  },

  IT_HARDWARE: {
    id: "IT_HARDWARE",
    name: "IT하드웨어"
  },

  SOFTWARE: {
    id: "SOFTWARE",
    name: "소프트웨어"
  },

  INTERNET: {
    id: "INTERNET",
    name: "인터넷"
  },

  TELECOM: {
    id: "TELECOM",
    name: "통신"
  },

  AUTO: {
    id: "AUTO",
    name: "자동차"
  },

  AUTO_PARTS: {
    id: "AUTO_PARTS",
    name: "자동차부품"
  },

  BATTERY: {
    id: "BATTERY",
    name: "2차전지"
  },

  CHEMICAL: {
    id: "CHEMICAL",
    name: "화학"
  },

  STEEL: {
    id: "STEEL",
    name: "철강"
  },

  NONFERROUS: {
    id: "NONFERROUS",
    name: "비철금속"
  },

  MACHINERY: {
    id: "MACHINERY",
    name: "기계"
  },

  ELECTRICAL_EQUIPMENT: {
    id: "ELECTRICAL_EQUIPMENT",
    name: "전력기기"
  },

  ROBOTICS: {
    id: "ROBOTICS",
    name: "로봇·자동화"
  },

  SHIPBUILDING: {
    id: "SHIPBUILDING",
    name: "조선"
  },

  DEFENSE: {
    id: "DEFENSE",
    name: "방산"
  },

  AEROSPACE: {
    id: "AEROSPACE",
    name: "항공·우주"
  },

  CONSTRUCTION: {
    id: "CONSTRUCTION",
    name: "건설"
  },

  BUILDING_MATERIALS: {
    id: "BUILDING_MATERIALS",
    name: "건자재"
  },

  ENERGY: {
    id: "ENERGY",
    name: "에너지"
  },

  UTILITIES: {
    id: "UTILITIES",
    name: "유틸리티"
  },

  BIO: {
    id: "BIO",
    name: "바이오"
  },

  PHARMA: {
    id: "PHARMA",
    name: "제약"
  },

  HEALTHCARE: {
    id: "HEALTHCARE",
    name: "헬스케어"
  },

  BANK: {
    id: "BANK",
    name: "은행"
  },

  SECURITIES: {
    id: "SECURITIES",
    name: "증권"
  },

  INSURANCE: {
    id: "INSURANCE",
    name: "보험"
  },

  FINANCE: {
    id: "FINANCE",
    name: "기타금융"
  },

  RETAIL: {
    id: "RETAIL",
    name: "유통"
  },

  FOOD: {
    id: "FOOD",
    name: "음식료"
  },

  CONSUMER: {
    id: "CONSUMER",
    name: "소비재"
  },

  COSMETICS: {
    id: "COSMETICS",
    name: "화장품"
  },

  FASHION: {
    id: "FASHION",
    name: "의류"
  },

  MEDIA: {
    id: "MEDIA",
    name: "미디어·콘텐츠"
  },

  LEISURE: {
    id: "LEISURE",
    name: "호텔·레저"
  },

  TRANSPORT: {
    id: "TRANSPORT",
    name: "운송"
  },

  HOLDING: {
    id: "HOLDING",
    name: "지주"
  },

  OTHER: {
    id: "OTHER",
    name: "기타"
  }

});


/* =========================================================
   CODE NORMALIZER
========================================================= */

function normalizeCode(value) {

  const raw =
    String(value || "")
      .trim();

  if (/^\d{6}$/.test(raw)) {
    return raw;
  }

  const match =
    raw.match(/(\d{6})/);

  return match
    ? match[1]
    : raw;
}


/* =========================================================
   NAME NORMALIZER
========================================================= */

function normalizeName(value) {

  return String(value || "")
    .trim()
    .toUpperCase();
}


/* =========================================================
   SAFE NAME INFERENCE

   주의:
   이름만으로 산업이 명확한 경우에만 사용한다.

   억지로 coverage를 높이기 위한 규칙은 넣지 않는다.
========================================================= */

function inferSectorFromName(value) {

  const name =
    normalizeName(value);

  if (!name) {
    return null;
  }


  /* =====================================================
     SECURITIES
  ===================================================== */

  if (
    /증권$/.test(name) ||
    /투자증권/.test(name) ||
    /SECURITIES/.test(name)
  ) {
    return "SECURITIES";
  }


  /* =====================================================
     INSURANCE
  ===================================================== */

  if (
    /손해보험/.test(name) ||
    /화재$/.test(name) ||
    /생명$/.test(name) ||
    /INSURANCE/.test(name)
  ) {
    return "INSURANCE";
  }


  /* =====================================================
     FINANCE
  ===================================================== */

  if (
    /금융지주/.test(name) ||
    /FINANCIAL GROUP/.test(name)
  ) {
    return "FINANCE";
  }


  /* =====================================================
     BANK
  ===================================================== */

  if (
    /은행$/.test(name) ||
    /BANK$/.test(name)
  ) {
    return "BANK";
  }


  /* =====================================================
     PHARMA

     BIO보다 먼저 검사
  ===================================================== */

  if (
    /제약/.test(name) ||
    /PHARM/.test(name)
  ) {
    return "PHARMA";
  }


  /* =====================================================
     BIO
  ===================================================== */

  if (
    /바이오/.test(name) ||
    /BIO/.test(name)
  ) {
    return "BIO";
  }


  /* =====================================================
     ROBOTICS
  ===================================================== */

  if (
    /로보틱스/.test(name) ||
    /로봇/.test(name) ||
    /ROBOTICS/.test(name)
  ) {
    return "ROBOTICS";
  }


  /* =====================================================
     SHIPBUILDING
  ===================================================== */

  if (
    /조선/.test(name)
  ) {
    return "SHIPBUILDING";
  }


  /* =====================================================
     CONSTRUCTION
  ===================================================== */

  if (
    /건설/.test(name)
  ) {
    return "CONSTRUCTION";
  }


  /* =====================================================
     COSMETICS
  ===================================================== */

  if (
    /코스메틱/.test(name) ||
    /COSMETIC/.test(name)
  ) {
    return "COSMETICS";
  }


  return null;
}


/* =========================================================
   RESOLVE SECTOR

   우선순위:
   1. SECTOR_MASTER
   2. NAME INFERENCE
   3. UNKNOWN
========================================================= */

function resolveSectorId(
  stockOrCode,
  maybeName
) {

  let code;
  let name;


  if (
    stockOrCode &&
    typeof stockOrCode === "object"
  ) {

    code =
      normalizeCode(
        stockOrCode.code
      );

    name =
      stockOrCode.name;

  } else {

    code =
      normalizeCode(
        stockOrCode
      );

    name =
      maybeName;
  }


  /* =====================================================
     PRIMARY MASTER
  ===================================================== */

  const masterSector =
    SECTOR_MASTER[
      code
    ];


  if (
    masterSector &&
    SECTORS[masterSector]
  ) {

    return masterSector;
  }


  /* =====================================================
     SAFE FALLBACK
  ===================================================== */

  const inferred =
    inferSectorFromName(
      name
    );


  if (
    inferred &&
    SECTORS[inferred]
  ) {

    return inferred;
  }


  return null;
}


/* =========================================================
   GET SECTOR ID

   sector-scan 기존 호환
========================================================= */

function getSectorId(
  code,
  name
) {

  return resolveSectorId(
    code,
    name
  );
}


/* =========================================================
   GET SECTOR
========================================================= */

function getSector(
  code,
  name
) {

  const normalizedCode =
    normalizeCode(
      code
    );


  const sectorId =
    resolveSectorId(
      normalizedCode,
      name
    );


  if (!sectorId) {

    return {

      id:
        "UNKNOWN",

      name:
        "미분류",

      classified:
        false,

      source:
        "UNKNOWN"
    };
  }


  const sector =
    SECTORS[
      sectorId
    ];


  if (!sector) {

    return {

      id:
        "UNKNOWN",

      name:
        "미분류",

      classified:
        false,

      source:
        "UNKNOWN"
    };
  }


  const source =
    SECTOR_MASTER[
      normalizedCode
    ]
      ? "MASTER"
      : "NAME_INFERENCE";


  return {

    ...sector,

    classified:
      true,

    source
  };
}


/* =========================================================
   CLASSIFY STOCK
========================================================= */

function classifyStock(stock) {

  const code =
    normalizeCode(
      stock?.code
    );


  const sector =
    getSector(
      code,
      stock?.name
    );


  return {

    ...stock,

    code,

    sectorId:
      sector.id,

    sector:
      sector.name,

    sectorClassified:
      sector.classified,

    sectorSource:
      sector.source
  };
}


/* =========================================================
   CLASSIFY ARRAY
========================================================= */

function classifyStocks(stocks) {

  if (!Array.isArray(stocks)) {
    return [];
  }


  return stocks.map(
    stock =>
      classifyStock(
        stock
      )
  );
}


/* =========================================================
   GROUP BY SECTOR
========================================================= */

function groupBySector(stocks) {

  const classified =
    classifyStocks(
      stocks
    );


  const groups = {};


  for (
    const stock of classified
  ) {

    const sectorId =
      stock.sectorId ||
      "UNKNOWN";


    if (!groups[sectorId]) {

      groups[sectorId] = {

        id:
          sectorId,

        name:
          stock.sector ||
          "미분류",

        stocks: []
      };
    }


    groups[
      sectorId
    ].stocks.push(
      stock
    );
  }


  return groups;
}


/* =========================================================
   CLASSIFICATION STATS
========================================================= */

function getClassificationStats(stocks) {

  if (!Array.isArray(stocks)) {

    return {

      total: 0,

      classified: 0,

      unclassified: 0,

      coverage: 0,

      master: 0,

      inferred: 0
    };
  }


  let classified = 0;
  let master = 0;
  let inferred = 0;


  for (
    const stock of stocks
  ) {

    const result =
      classifyStock(
        stock
      );


    if (
      !result.sectorClassified
    ) {
      continue;
    }


    classified++;


    if (
      result.sectorSource ===
      "MASTER"
    ) {

      master++;

    } else if (
      result.sectorSource ===
      "NAME_INFERENCE"
    ) {

      inferred++;
    }
  }


  const total =
    stocks.length;


  const unclassified =
    total -
    classified;


  const coverage =
    total > 0
      ? (
          classified /
          total
        ) * 100
      : 0;


  return {

    total,

    classified,

    unclassified,

    coverage:
      Number(
        coverage.toFixed(2)
      ),

    master,

    inferred
  };
}


/* =========================================================
   LIST UNCLASSIFIED
========================================================= */

function getUnclassifiedStocks(stocks) {

  if (!Array.isArray(stocks)) {
    return [];
  }


  return stocks.filter(
    stock => {

      const result =
        classifyStock(
          stock
        );


      return (
        !result.sectorClassified
      );
    }
  );
}


/* =========================================================
   EXPORT

   STOCK_SECTOR_MAP alias를 유지하는 이유:
   혹시 기존 다른 코드에서 STOCK_SECTOR_MAP을
   참조해도 깨지지 않도록 한다.
========================================================= */

module.exports = {

  SECTORS,

  SECTOR_MASTER,

  STOCK_SECTOR_MAP:
    SECTOR_MASTER,

  normalizeCode,

  normalizeName,

  inferSectorFromName,

  resolveSectorId,

  getSectorId,

  getSector,

  classifyStock,

  classifyStocks,

  groupBySector,

  getClassificationStats,

  getUnclassifiedStocks
};/* =========================================================
   LEADER CYCLE - SECTOR MAP V2

   목적
   ---------------------------------------------------------
   종목 → 투자자 관점 Primary Sector 분류

   원칙
   1. 테마 사용 금지
   2. Primary Sector 1개
   3. 검증된 종목은 MANUAL MAP 최우선
   4. 확실한 종목명 패턴만 자동 분류
   5. 애매하면 UNKNOWN
   6. 향후 공식 산업분류 데이터 연결 가능
========================================================= */


/* =========================================================
   STANDARD SECTORS
========================================================= */

const SECTORS = Object.freeze({

  SEMICONDUCTOR: { id: "SEMICONDUCTOR", name: "반도체" },
  DISPLAY: { id: "DISPLAY", name: "디스플레이" },

  IT_HARDWARE: { id: "IT_HARDWARE", name: "IT하드웨어" },
  SOFTWARE: { id: "SOFTWARE", name: "소프트웨어" },
  INTERNET: { id: "INTERNET", name: "인터넷" },
  TELECOM: { id: "TELECOM", name: "통신" },

  AUTO: { id: "AUTO", name: "자동차" },
  AUTO_PARTS: { id: "AUTO_PARTS", name: "자동차부품" },

  BATTERY: { id: "BATTERY", name: "2차전지" },

  CHEMICAL: { id: "CHEMICAL", name: "화학" },
  STEEL: { id: "STEEL", name: "철강" },
  NONFERROUS: { id: "NONFERROUS", name: "비철금속" },

  MACHINERY: { id: "MACHINERY", name: "기계" },

  ELECTRICAL_EQUIPMENT: {
    id: "ELECTRICAL_EQUIPMENT",
    name: "전력기기"
  },

  ROBOTICS: { id: "ROBOTICS", name: "로봇·자동화" },

  SHIPBUILDING: { id: "SHIPBUILDING", name: "조선" },
  DEFENSE: { id: "DEFENSE", name: "방산" },
  AEROSPACE: { id: "AEROSPACE", name: "항공·우주" },

  CONSTRUCTION: { id: "CONSTRUCTION", name: "건설" },

  BUILDING_MATERIALS: {
    id: "BUILDING_MATERIALS",
    name: "건자재"
  },

  ENERGY: { id: "ENERGY", name: "에너지" },
  UTILITIES: { id: "UTILITIES", name: "유틸리티" },

  BIO: { id: "BIO", name: "바이오" },
  PHARMA: { id: "PHARMA", name: "제약" },
  HEALTHCARE: { id: "HEALTHCARE", name: "헬스케어" },

  BANK: { id: "BANK", name: "은행" },
  SECURITIES: { id: "SECURITIES", name: "증권" },
  INSURANCE: { id: "INSURANCE", name: "보험" },
  FINANCE: { id: "FINANCE", name: "기타금융" },

  RETAIL: { id: "RETAIL", name: "유통" },
  FOOD: { id: "FOOD", name: "음식료" },
  CONSUMER: { id: "CONSUMER", name: "소비재" },
  COSMETICS: { id: "COSMETICS", name: "화장품" },
  FASHION: { id: "FASHION", name: "의류" },

  MEDIA: { id: "MEDIA", name: "미디어·콘텐츠" },
  LEISURE: { id: "LEISURE", name: "호텔·레저" },
  TRANSPORT: { id: "TRANSPORT", name: "운송" },

  HOLDING: { id: "HOLDING", name: "지주" },
  OTHER: { id: "OTHER", name: "기타" }

});


/* =========================================================
   VERIFIED MANUAL MAP

   투자자 관점에서 검증한 종목.
   자동분류보다 항상 우선한다.
========================================================= */

const STOCK_SECTOR_MAP = Object.freeze({

  /* 반도체 */

  "005930": "SEMICONDUCTOR",
  "000660": "SEMICONDUCTOR",
  "042700": "SEMICONDUCTOR",
  "403870": "SEMICONDUCTOR",

  /* 자동차 */

  "005380": "AUTO",
  "000270": "AUTO",

  /* 2차전지 */

  "373220": "BATTERY",
  "003670": "BATTERY",

  /* 전력기기 */

  "267260": "ELECTRICAL_EQUIPMENT",
  "298040": "ELECTRICAL_EQUIPMENT",
  "010120": "ELECTRICAL_EQUIPMENT",

  /* 조선 */

  "009540": "SHIPBUILDING",
  "042660": "SHIPBUILDING",
  "010140": "SHIPBUILDING",

  /* 방산 */

  "012450": "DEFENSE",
  "079550": "DEFENSE",
  "064350": "DEFENSE",

  /* 항공우주 */

  "047810": "AEROSPACE",
  "272210": "AEROSPACE",

  /* 로봇 */

  "454910": "ROBOTICS",
  "277810": "ROBOTICS",

  /* 바이오 */

  "207940": "BIO",
  "068270": "BIO"

});


/* =========================================================
   NORMALIZE CODE
========================================================= */

function normalizeCode(value) {

  const raw =
    String(value || "").trim();

  if (/^\d{6}$/.test(raw)) {
    return raw;
  }

  const match =
    raw.match(/(\d{6})/);

  return match
    ? match[1]
    : raw;
}


/* =========================================================
   NAME NORMALIZER
========================================================= */

function normalizeName(value) {

  return String(value || "")
    .trim()
    .toUpperCase();
}


/* =========================================================
   SAFE NAME-BASED CLASSIFICATION

   종목명 자체가 업종을 강하게 의미하는 경우만 사용.

   애매한 키워드는 절대 넣지 않는다.
========================================================= */

function inferSectorFromName(name) {

  const n =
    normalizeName(name);


  if (!n) {
    return null;
  }


  /* -------------------------------------------------------
     증권
  ------------------------------------------------------- */

  if (
    /증권$/.test(n) ||
    /투자증권/.test(n) ||
    /SECURITIES/.test(n)
  ) {
    return "SECURITIES";
  }


  /* -------------------------------------------------------
     보험
  ------------------------------------------------------- */

  if (
    /손해보험/.test(n) ||
    /생명$/.test(n) ||
    /화재$/.test(n) ||
    /INSURANCE/.test(n)
  ) {
    return "INSURANCE";
  }


  /* -------------------------------------------------------
     은행 / 금융지주

     금융지주는 FINANCE로 분리
  ------------------------------------------------------- */

  if (
    /금융지주/.test(n) ||
    /FINANCIAL GROUP/.test(n)
  ) {
    return "FINANCE";
  }


  if (
    /은행$/.test(n) ||
    /BANK$/.test(n)
  ) {
    return "BANK";
  }


  /* -------------------------------------------------------
     제약
  ------------------------------------------------------- */

  if (
    /제약/.test(n) ||
    /PHARM/.test(n)
  ) {
    return "PHARMA";
  }


  /* -------------------------------------------------------
     바이오

     제약보다 뒤에서 검사
  ------------------------------------------------------- */

  if (
    /바이오/.test(n) ||
    /BIO/.test(n)
  ) {
    return "BIO";
  }


  /* -------------------------------------------------------
     건설
  ------------------------------------------------------- */

  if (
    /건설/.test(n) ||
    /건설산업/.test(n)
  ) {
    return "CONSTRUCTION";
  }


  /* -------------------------------------------------------
     조선

     이름 자체에 조선이 명시된 경우
  ------------------------------------------------------- */

  if (
    /조선/.test(n)
  ) {
    return "SHIPBUILDING";
  }


  /* -------------------------------------------------------
     로봇
  ------------------------------------------------------- */

  if (
    /로보틱스/.test(n) ||
    /로봇/.test(n) ||
    /ROBOTICS/.test(n)
  ) {
    return "ROBOTICS";
  }


  /* -------------------------------------------------------
     화장품
  ------------------------------------------------------- */

  if (
    /코스메틱/.test(n) ||
    /COSMETIC/.test(n)
  ) {
    return "COSMETICS";
  }


  return null;
}


/* =========================================================
   RESOLVE SECTOR ID

   우선순위
   ---------------------------------------------------------
   1. Manual verified map
   2. Safe name inference
   3. UNKNOWN
========================================================= */

function resolveSectorId(stockOrCode, maybeName) {

  let code;
  let name;


  if (
    stockOrCode &&
    typeof stockOrCode === "object"
  ) {

    code =
      normalizeCode(
        stockOrCode.code
      );

    name =
      stockOrCode.name;

  } else {

    code =
      normalizeCode(
        stockOrCode
      );

    name =
      maybeName;
  }


  /* VERIFIED MAP */

  const verified =
    STOCK_SECTOR_MAP[
      code
    ];

  if (verified) {
    return verified;
  }


  /* SAFE AUTO CLASSIFICATION */

  const inferred =
    inferSectorFromName(
      name
    );

  if (inferred) {
    return inferred;
  }


  return null;
}


/* =========================================================
   GET SECTOR ID

   기존 코드 호환 유지
========================================================= */

function getSectorId(
  code,
  name
) {

  return resolveSectorId(
    code,
    name
  );
}


/* =========================================================
   GET SECTOR
========================================================= */

function getSector(
  code,
  name
) {

  const sectorId =
    resolveSectorId(
      code,
      name
    );


  if (!sectorId) {

    return {
      id: "UNKNOWN",
      name: "미분류",
      classified: false,
      source: "UNKNOWN"
    };
  }


  const sector =
    SECTORS[
      sectorId
    ];


  if (!sector) {

    return {
      id: "UNKNOWN",
      name: "미분류",
      classified: false,
      source: "UNKNOWN"
    };
  }


  const normalized =
    normalizeCode(code);


  const source =
    STOCK_SECTOR_MAP[
      normalized
    ]
      ? "VERIFIED"
      : "NAME_INFERENCE";


  return {
    ...sector,

    classified: true,

    source
  };
}


/* =========================================================
   CLASSIFY STOCK
========================================================= */

function classifyStock(stock) {

  const code =
    normalizeCode(
      stock?.code
    );


  const sector =
    getSector(
      code,
      stock?.name
    );


  return {

    ...stock,

    code,

    sectorId:
      sector.id,

    sector:
      sector.name,

    sectorClassified:
      sector.classified,

    sectorSource:
      sector.source
  };
}


/* =========================================================
   CLASSIFY ARRAY
========================================================= */

function classifyStocks(stocks) {

  if (!Array.isArray(stocks)) {
    return [];
  }

  return stocks.map(
    classifyStock
  );
}


/* =========================================================
   GROUP BY SECTOR
========================================================= */

function groupBySector(stocks) {

  const classified =
    classifyStocks(stocks);


  const groups = {};


  for (
    const stock of classified
  ) {

    const sectorId =
      stock.sectorId ||
      "UNKNOWN";


    if (!groups[sectorId]) {

      groups[sectorId] = {

        id:
          sectorId,

        name:
          stock.sector ||
          "미분류",

        stocks: []
      };
    }


    groups[
      sectorId
    ].stocks.push(
      stock
    );
  }


  return groups;
}


/* =========================================================
   CLASSIFICATION STATS
========================================================= */

function getClassificationStats(
  stocks
) {

  if (!Array.isArray(stocks)) {

    return {
      total: 0,
      classified: 0,
      unclassified: 0,
      coverage: 0,
      verified: 0,
      inferred: 0
    };
  }


  let classified = 0;
  let verified = 0;
  let inferred = 0;


  for (
    const stock of stocks
  ) {

    const result =
      classifyStock(
        stock
      );


    if (
      result.sectorClassified
    ) {

      classified++;


      if (
        result.sectorSource ===
        "VERIFIED"
      ) {

        verified++;

      } else if (
        result.sectorSource ===
        "NAME_INFERENCE"
      ) {

        inferred++;
      }
    }
  }


  const total =
    stocks.length;


  const unclassified =
    total -
    classified;


  const coverage =
    total > 0
      ? (
          classified /
          total
        ) * 100
      : 0;


  return {

    total,

    classified,

    unclassified,

    coverage:
      Number(
        coverage.toFixed(2)
      ),

    verified,

    inferred
  };
}


/* =========================================================
   UNCLASSIFIED STOCKS
========================================================= */

function getUnclassifiedStocks(
  stocks
) {

  if (!Array.isArray(stocks)) {
    return [];
  }


  return stocks.filter(
    stock =>
      !resolveSectorId(
        stock
      )
  );
}


/* =========================================================
   EXPORT
========================================================= */

module.exports = {

  SECTORS,

  STOCK_SECTOR_MAP,

  normalizeCode,

  inferSectorFromName,

  resolveSectorId,

  getSectorId,

  getSector,

  classifyStock,

  classifyStocks,

  groupBySector,

  getClassificationStats,

  getUnclassifiedStocks
};
