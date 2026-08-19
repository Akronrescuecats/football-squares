import crypto from "crypto";

const SHEET_NAME = "Squares";
const SETTINGS_SHEET_NAME = "Settings";

const PRESEASON_2_GAME_NAMES = [
  "preseason 2",
  "pre season 2",
  "preseason game 2",
  "pre season game 2"
];

/*
=====================================================
GOOGLE AUTH
=====================================================
*/

function base64Url(input) {
  return Buffer
    .from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}


function getGoogleCredentials() {
  const raw =
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (!raw) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON is missing."
    );
  }

  const credentials =
    JSON.parse(raw);

  if (
    !credentials.client_email ||
    !credentials.private_key
  ) {
    throw new Error(
      "Google credentials are incomplete."
    );
  }

  return credentials;
}


async function getGoogleAccessToken() {
  const credentials =
    getGoogleCredentials();

  const now =
    Math.floor(Date.now() / 1000);

  const header = {
    alg: "RS256",
    typ: "JWT"
  };

  const claims = {
    iss:
      credentials.client_email,

    scope:
      "https://www.googleapis.com/auth/spreadsheets",

    aud:
      "https://oauth2.googleapis.com/token",

    iat:
      now,

    exp:
      now + 3600
  };

  const unsignedToken =
    base64Url(
      JSON.stringify(header)
    ) +
    "." +
    base64Url(
      JSON.stringify(claims)
    );

  const privateKey =
    crypto.createPrivateKey({
      key:
        credentials.private_key,

      format:
        "pem"
    });

  const signature =
    crypto.sign(
      "RSA-SHA256",
      Buffer.from(
        unsignedToken
      ),
      privateKey
    );

  const jwt =
    unsignedToken +
    "." +
    base64Url(
      signature
    );

  const response =
    await fetch(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded"
        },

        body:
          new URLSearchParams({
            grant_type:
              "urn:ietf:params:oauth:grant-type:jwt-bearer",

            assertion:
              jwt
          })
      }
    );

  const data =
    await response.json();

  if (
    !response.ok ||
    !data.access_token
  ) {
    throw new Error(
      data.error_description ||
      "Google authentication failed."
    );
  }

  return data.access_token;
}


/*
=====================================================
PRESEASON BOARD 2 SPREADSHEET
=====================================================
*/

function getSpreadsheetId() {
  const id =
    process.env
      .PRESEASON_2_SPREADSHEET_ID;

  if (!id) {
    throw new Error(
      "PRESEASON_2_SPREADSHEET_ID is missing."
    );
  }

  return id;
}


/*
=====================================================
READ PRICE FROM SETTINGS
=====================================================
*/

async function getPricePerSquare(
  token
) {
  const spreadsheetId =
    getSpreadsheetId();

  const range =
    encodeURIComponent(
      `${SETTINGS_SHEET_NAME}!B2`
    );

  const url =
    "https://sheets.googleapis.com/v4/spreadsheets/" +
    spreadsheetId +
    "/values/" +
    range;

  const response =
    await fetch(
      url,
      {
        headers: {
          Authorization:
            "Bearer " +
            token
        },

        cache:
          "no-store"
      }
    );

  const data =
    await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
      "Could not read the board price."
    );
  }

  const price =
    Number(
      data?.values?.[0]?.[0]
    );

  if (
    !Number.isFinite(price) ||
    price <= 0
  ) {
    throw new Error(
      "The price per square in Settings!B2 is invalid."
    );
  }

  return price;
}


/*
=====================================================
READ SQUARES
=====================================================
*/

async function getAllRows(
  token
) {
  const spreadsheetId =
    getSpreadsheetId();

  const range =
    encodeURIComponent(
      `${SHEET_NAME}!A2:L101`
    );

  const url =
    "https://sheets.googleapis.com/v4/spreadsheets/" +
    spreadsheetId +
    "/values/" +
    range;

  const response =
    await fetch(
      url,
      {
        headers: {
          Authorization:
            "Bearer " +
            token
        },

        cache:
          "no-store"
      }
    );

  const data =
    await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
      "Could not read the Squares sheet."
    );
  }

  const sourceRows =
    data.values || [];

  const rows = [];

  for (
    let index = 0;
    index < 100;
    index++
  ) {
    const source =
      sourceRows[index] || [];

    rows.push([
      source[0] ||
        String(index + 1),

      source[1] || "",
      source[2] || "",
      source[3] || "",
      source[4] || "",
      source[5] || "",
      source[6] || "",
      source[7] || "",
      source[8] || "",
      source[9] || "",
      source[10] || "",
      source[11] || ""
    ]);
  }

  return rows;
}


/*
=====================================================
UPDATE SHEET
=====================================================
*/

async function batchUpdateRows(
  token,
  updates
) {
  if (!updates.length) {
    return;
  }

  const spreadsheetId =
    getSpreadsheetId();

  const url =
    "https://sheets.googleapis.com/v4/spreadsheets/" +
    spreadsheetId +
    "/values:batchUpdate";

  const response =
    await fetch(
      url,
      {
        method:
          "POST",

        headers: {
          Authorization:
            "Bearer " +
            token,

          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify({
            valueInputOption:
              "RAW",

            data:
              updates
          })
      }
    );

  const data =
    await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
      "Could not update the Squares sheet."
    );
  }
}


/*
=====================================================
HELPERS
=====================================================
*/

function cleanText(value) {
  return String(
    value ?? ""
  ).trim();
}


function normalizeStatus(value) {
  return cleanText(value)
    .toLowerCase();
}


function findQuestionAnswer(
  questions,
  phrase
) {
  if (
    !Array.isArray(questions)
  ) {
    return "";
  }

  const target =
    phrase.toLowerCase();

  const match =
    questions.find(
      function(item) {

        return cleanText(
          item?.question
        )
          .toLowerCase()
          .includes(
            target
          );
      }
    );

  return cleanText(
    match?.answer
  );
}


function parseSquares(value) {
  const matches =
    cleanText(value)
      .match(/\d+/g) ||
    [];

  const squares =
    Array.from(
      new Set(
        matches
          .map(Number)
          .filter(
            function(number) {
              return (
                Number.isInteger(number) &&
                number >= 1 &&
                number <= 100
              );
            }
          )
      )
    )
      .sort(
        function(a, b) {
          return a - b;
        }
      );

  if (!squares.length) {
    throw new Error(
      "No valid square numbers were found in the Zeffy payment."
    );
  }

  return squares;
}


function isPreseason2(value) {
  const normalized =
    cleanText(value)
      .toLowerCase()
      .replace(/\s+/g, " ");

  return PRESEASON_2_GAME_NAMES
    .some(
      function(name) {
        return (
          normalized ===
          name
        );
      }
    );
}


/*
=====================================================
PROCESS PRESEASON BOARD 2 PAYMENT
=====================================================
*/

async function processPreseason2Payment(
  payment
) {
  const googleToken =
    await getGoogleAccessToken();

  const paymentId =
    cleanText(
      payment?.id
    );

  const paymentStatus =
    cleanText(
      payment?.status
    ).toLowerCase();

  const currency =
    cleanText(
      payment?.currency
    ).toLowerCase();

  const buyerEmail =
    cleanText(
      payment?.buyer?.email
    ).toLowerCase();

  const amountCents =
    Number(
      payment?.amount
    );

  const questions =
    payment?.buyer_questions;

  const squareAnswer =
    findQuestionAnswer(
      questions,
      "square number"
    );

  const gameAnswer =
    findQuestionAnswer(
      questions,
      "which game"
    );

  if (!paymentId) {
    throw new Error(
      "Zeffy payment ID is missing."
    );
  }

  if (
    paymentStatus !==
    "succeeded"
  ) {
    throw new Error(
      "The Zeffy payment is not successful."
    );
  }

  if (
    currency !==
    "usd"
  ) {
    throw new Error(
      "The Zeffy payment currency is not USD."
    );
  }

  if (!buyerEmail) {
    throw new Error(
      "The Zeffy buyer email is missing."
    );
  }

  if (
    !isPreseason2(
      gameAnswer
    )
  ) {
    throw new Error(
      "This payment is not for Preseason Board 2."
    );
  }

  const squares =
    parseSquares(
      squareAnswer
    );

  const pricePerSquare =
    await getPricePerSquare(
      googleToken
    );

  const expectedCents =
    Math.round(
      squares.length *
      pricePerSquare *
      100
    );

  if (
    amountCents !==
    expectedCents
  ) {
    throw new Error(
      "Zeffy payment amount does not match the selected squares."
    );
  }

  const rows =
    await getAllRows(
      googleToken
    );


  /*
  Prevent duplicate processing.
  */

  const alreadyRecorded =
    rows.some(
      function(row) {
        return (
          cleanText(
            row[8]
          ) ===
          paymentId
        );
      }
    );

  if (
    alreadyRecorded
  ) {
    return {
      success:
        true,

      alreadyProcessed:
        true,

      paymentId:
        paymentId,

      squares:
        squares
    };
  }


  /*
  Verify every square is still Pending
  for the same email.
  */

  squares.forEach(
    function(squareNumber) {

      const row =
        rows[
          squareNumber - 1
        ];

      const status =
        normalizeStatus(
          row[1]
        );

      const reservedEmail =
        cleanText(
          row[3]
        ).toLowerCase();

      if (
        status !==
        "pending"
      ) {
        throw new Error(
          "Square " +
          squareNumber +
          " is not currently pending."
        );
      }

      if (
        reservedEmail !==
        buyerEmail
      ) {
        throw new Error(
          "Square " +
          squareNumber +
          " belongs to a different reservation email."
        );
      }
    }
  );


  /*
  Mark all paid squares Sold.
  */

  const paymentDate =
    new Date()
      .toISOString();

  const updates = [];

  squares.forEach(
    function(squareNumber) {

      const row =
        rows[
          squareNumber - 1
        ];

      const sheetRow =
        squareNumber + 1;

      updates.push({
        range:
          `${SHEET_NAME}!B${sheetRow}:L${sheetRow}`,

        values: [[

          "Sold",

          row[2] || "",

          row[3] || "",

          row[4] || "",

          row[5] || "",

          "Zeffy",

          "Paid",

          paymentId,

          pricePerSquare,

          paymentDate,

          row[11] || ""

        ]]
      });
    }
  );

  await batchUpdateRows(
    googleToken,
    updates
  );

  return {
    success:
      true,

    paymentId:
      paymentId,

    squares:
      squares,

    amount:
      expectedCents /
      100
  };
}


/*
=====================================================
WEBHOOK
=====================================================
*/

export default {

  async fetch(request) {

    /*
    Browser health check.
    */

    if (
      request.method !==
      "POST"
    ) {
      return Response.json(
        {
          success:
            true,

          message:
            "Zeffy webhook endpoint is active."
        },
        {
          status:
            200
        }
      );
    }


    try {

      const body =
        await request.json();

      console.log(
        "ZEFFY WEBHOOK RECEIVED:",
        JSON.stringify(
          body
        )
      );


      /*
      Only completed payments.
      */

      if (
        cleanText(
          body?.type
        ) !==
        "payment.completed"
      ) {

        return Response.json(
          {
            success:
              true,

            ignored:
              true,

            reason:
              "Not a payment.completed event."
          },
          {
            status:
              200
          }
        );
      }


      const payment =
        body?.data;

      if (!payment) {
        throw new Error(
          "Zeffy payment data is missing."
        );
      }


      const gameAnswer =
        findQuestionAnswer(
          payment
            ?.buyer_questions,

          "which game"
        );


      /*
      For now this webhook only automates
      PRESEASON BOARD 2.
      */

      if (
        !isPreseason2(
          gameAnswer
        )
      ) {

        console.log(
          "ZEFFY PAYMENT IGNORED - GAME:",
          gameAnswer
        );

        return Response.json(
          {
            success:
              true,

            ignored:
              true,

            reason:
              "This board has not been connected to the Zeffy webhook yet."
          },
          {
            status:
              200
          }
        );
      }


      const result =
        await processPreseason2Payment(
          payment
        );


      console.log(
        "ZEFFY PAYMENT PROCESSED:",
        JSON.stringify(
          result
        )
      );


      return Response.json(
        result,
        {
          status:
            200
        }
      );


    } catch (error) {

      console.error(
        "ZEFFY WEBHOOK ERROR:",
        error
      );


      /*
      Return an error so we can clearly see
      failed payment matching in Vercel.
      */

      return Response.json(
        {
          success:
            false,

          message:
            error?.message ||
            String(error)
        },
        {
          status:
            500
        }
      );
    }
  }
};
