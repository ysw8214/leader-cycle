/* ============================================
   LEADER CYCLE
   DART CORP CODE MAPPER - FAST VERSION

   stockCode -> DART corpCode

   서버 실행 중 DART 전체 ZIP 다운로드 안 함
   따라서 매우 빠름
============================================ */


/* ============================================
   주요 종목 매핑

   필요한 종목은 계속 추가 가능
============================================ */

const CORP_MAP = {

  "005930": {
    corpCode: "00126380",
    corpName: "삼성전자"
  },

  "000660": {
    corpCode: "00164779",
    corpName: "SK하이닉스"
  },

  "009150": {
    corpCode: "00126362",
    corpName: "삼성전기"
  }

};


/* ============================================
   HANDLER
============================================ */

module.exports = async function handler(req, res) {

  try {

    const rawCode =
      String(
        req.query.code || ""
      ).trim();


    /* ========================================
       종목코드 검사
    ======================================== */

    if (!rawCode) {

      return res.status(400).json({

        ok: false,

        error:
          "종목코드를 입력하세요.",

        example:
          "/api/dart-corp?code=005930"

      });

    }


    const code =
      rawCode.padStart(6, "0");


    if (!/^\d{6}$/.test(code)) {

      return res.status(400).json({

        ok: false,

        error:
          "올바른 6자리 종목코드를 입력하세요.",

        received:
          rawCode

      });

    }


    /* ========================================
       기업코드 검색
    ======================================== */

    const company =
      CORP_MAP[code];


    if (!company) {

      return res.status(404).json({

        ok: false,

        version:
          "DART_CORP_FAST_V1",

        code,

        error:
          "아직 로컬 DART 기업코드 목록에 없는 종목입니다.",

        nextStep:
          "전체 KRX 종목의 DART corpCode 자동 매핑을 추가해야 합니다."

      });

    }


    /* ========================================
       CACHE
    ======================================== */

    res.setHeader(

      "Cache-Control",

      "public, s-maxage=86400, stale-while-revalidate=604800"

    );


    /* ========================================
       RESPONSE
    ======================================== */

    return res.status(200).json({

      ok: true,

      version:
        "DART_CORP_FAST_V1",

      code,

      corpCode:
        company.corpCode,

      corpName:
        company.corpName

    });


  } catch (error) {

    console.error(
      "DART CORP ERROR",
      error
    );


    return res.status(500).json({

      ok: false,

      error:
        String(
          error?.message ||
          error
        )

    });

  }

};
