import crypto from "crypto";

const SHEET_NAME = "Squares";
const SETTINGS_SHEET_NAME = "Settings";
const CURRENCY_CODE = "USD";

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

  let credentials;

  try {
    credentials = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON."
    );
  }

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


async function getAccessToken() {
  const credentials =
    getGoogleCredentials();

  const now =
    Math.floor(Date.now() / 1000);

  const header = {
    alg: "RS256",
    typ: "JWT"
  };

  const claims = {
    iss: credentials.client_email,
    scope:
      "https://www.googleapis.com/auth/spreadsheets",
    aud:
      "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
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
    base64Url(signature);

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
SPREADSHEET
=====================================================
*/

function getSpreadsheetId() {
  const id =
    process.env
      .PRESEASON_3_SPREADSHEET_ID;

  if (!id) {
    throw new Error(
      "PRESEASON_3_SPREADSHEET_ID is missing."
    );
  }

  return id;
}


/*
=====================================================
READ SETTINGS TAB
=====================================================

Settings:

B2 = Price Per Square
B3 = Board Title
B4 = Hold Minutes
B5 = 1st Quarter Payout
B6 = Halftime Payout
B7 = 3rd Quarter Payout
B8 = Final Payout
=====================================================
*/

async function getSettings(
  token
) {
  const spreadsheetId =
    getSpreadsheetId();

  const range =
    encodeURIComponent(
      `${SETTINGS_SHEET_NAME}!B2:B8`
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
            "Bearer " + token
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
      "Could not read the Settings tab."
    );
  }

  const values =
    data.values || [];

  const getValue =
    function(index) {
      return values[index]?.[0] ?? "";
    };

  const pricePerSquare =
    Number(getValue(0));

  const boardTitle =
    String(
      getValue(1) ||
      "2026 Preseason Weeks 1-3"
    ).trim();

  const holdMinutes =
    Number(getValue(2));

  const q1 =
    Number(getValue(3));

  const halftime =
    Number(getValue(4));

  const q3 =
    Number(getValue(5));

  const final =
    Number(getValue(6));

  if (
    !Number.isFinite(
      pricePerSquare
    ) ||
    pricePerSquare <= 0
  ) {
    throw new Error(
      "Price Per Square in Settings!B2 is invalid."
    );
  }

  if (
    !Number.isFinite(
      holdMinutes
    ) ||
    holdMinutes <= 0
  ) {
    throw new Error(
      "Hold Minutes in Settings!B4 is invalid."
    );
  }

  return {
    pricePerSquare:
      pricePerSquare,

    boardTitle:
      boardTitle,

    holdMinutes:
      holdMinutes,

    payouts: {
      q1:
        Number.isFinite(q1)
          ? q1
          : 0,

      halftime:
        Number.isFinite(halftime)
          ? halftime
          : 0,

      q3:
        Number.isFinite(q3)
          ? q3
          : 0,

      final:
        Number.isFinite(final)
          ? final
          : 0
    }
  };
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
            "Bearer " + token
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
      "Could not read the football squares sheet."
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

      source[1] ||
        "Available",

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


async function batchUpdateRows(
  token,
  updates
) {
  if (
    !Array.isArray(updates) ||
    updates.length === 0
  ) {
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
        method: "POST",

        headers: {
          Authorization:
            "Bearer " + token,

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

  const result =
    await response.json();

  if (!response.ok) {
    throw new Error(
      result?.error?.message ||
      "Could not update the football squares sheet."
    );
  }

  return result;
}


/*
=====================================================
HELPERS
=====================================================
*/

function normalizeStatus(
  value
) {
  const status =
    String(value || "")
      .trim()
      .toLowerCase();

  if (status === "sold") {
    return "Sold";
  }

  if (status === "pending") {
    return "Pending";
  }

  return "Available";
}


function normalizeSquareList(
  values
) {
  if (!Array.isArray(values)) {
    throw new Error(
      "Please select at least one square."
    );
  }

  const squares =
    Array.from(
      new Set(
        values.map(
          function(value) {
            return Number(value);
          }
        )
      )
    )
      .filter(
        function(number) {
          return (
            Number.isInteger(number) &&
            number >= 1 &&
            number <= 100
          );
        }
      )
      .sort(
        function(a, b) {
          return a - b;
        }
      );

  if (
    squares.length === 0
  ) {
    throw new Error(
      "Please select at least one square."
    );
  }

  return squares;
}


function rowsToPublicSquares(
  rows
) {
  return rows.map(
    function(row, index) {
      return {
        square:
          Number(
            row[0] ||
            index + 1
          ),

        status:
          normalizeStatus(
            row[1]
          ),

        name:
          String(
            row[2] || ""
          )
      };
    }
  );
}


/*
=====================================================
RELEASE EXPIRED RESERVATIONS
=====================================================
*/

async function releaseExpiredReservations(
  token,
  rows,
  holdMinutes
) {
  const now =
    Date.now();

  const updates = [];

  rows.forEach(
    function(row, index) {

      if (
        normalizeStatus(
          row[1]
        ) !== "Pending"
      ) {
        return;
      }

      const reservedAt =
        new Date(
          row[5]
        );

      if (
        Number.isNaN(
          reservedAt.getTime()
        )
      ) {
        return;
      }

      const minutesPassed =
        (
          now -
          reservedAt.getTime()
        ) / 60000;

      if (
        minutesPassed <
        holdMinutes
      ) {
        return;
      }

      const sheetRow =
        index + 2;

      updates.push({
        range:
          `${SHEET_NAME}!B${sheetRow}:L${sheetRow}`,

        values: [[
          "Available",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          ""
        ]]
      });
    }
  );

  await batchUpdateRows(
    token,
    updates
  );

  return updates.length;
}


/*
=====================================================
RESERVE SQUARES
=====================================================
*/

async function reserveSquares(
  token,
  formData
) {
  if (!formData) {
    throw new Error(
      "Reservation information is missing."
    );
  }

  const settings =
    await getSettings(
      token
    );

  const squares =
    normalizeSquareList(
      formData.squares
    );

  const name =
    String(
      formData.name || ""
    ).trim();

  const email =
    String(
      formData.email || ""
    )
      .trim()
      .toLowerCase();

  const phone =
    String(
      formData.phone || ""
    ).trim();

  if (
    !name ||
    !email ||
    !phone
  ) {
    throw new Error(
      "Please enter your name, email, and phone number."
    );
  }

  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/
      .test(email)
  ) {
    throw new Error(
      "Please enter a valid email address."
    );
  }

  let rows =
    await getAllRows(
      token
    );

  await releaseExpiredReservations(
    token,
    rows,
    settings.holdMinutes
  );

  rows =
    await getAllRows(
      token
    );

  const unavailable = [];

  squares.forEach(
    function(squareNumber) {

      const row =
        rows[
          squareNumber - 1
        ];

      if (
        normalizeStatus(
          row[1]
        ) !== "Available"
      ) {
        unavailable.push(
          squareNumber
        );
      }
    }
  );

  if (
    unavailable.length > 0
  ) {
    throw new Error(
      "These squares are no longer available: " +
      unavailable.join(", ") +
      ". Please choose again."
    );
  }

  const reservedAt =
    new Date()
      .toISOString();

  const reservationId =
    crypto.randomUUID();

  const updates = [];

  squares.forEach(
    function(squareNumber) {

      const sheetRow =
        squareNumber + 1;

      updates.push({
        range:
          `${SHEET_NAME}!B${sheetRow}:L${sheetRow}`,

        values: [[
          "Pending",
          name,
          email,
          phone,
          reservedAt,
          "",
          "Awaiting Payment",
          "",
          "",
          "",
          reservationId
        ]]
      });
    }
  );

  await batchUpdateRows(
    token,
    updates
  );

  return {
    success:
      true,

    squares:
      squares,

    name:
      name,

    email:
      email,

    phone:
      phone,

    quantity:
      squares.length,

    pricePerSquare:
      settings.pricePerSquare,

    total:
      squares.length *
      settings.pricePerSquare,

    expiresInMinutes:
      settings.holdMinutes,

    reservationId:
      reservationId,

    settings:
      settings
  };
}


/*
=====================================================
PAYPAL AUTH
=====================================================
*/

async function getPayPalAccessToken() {
  const clientId =
    process.env
      .PAYPAL_CLIENT_ID;

  const clientSecret =
    process.env
      .PAYPAL_CLIENT_SECRET;

  if (
    !clientId ||
    !clientSecret
  ) {
    throw new Error(
      "PayPal credentials are missing."
    );
  }

  const authorization =
    Buffer
      .from(
        clientId +
        ":" +
        clientSecret
      )
      .toString(
        "base64"
      );

  const response =
    await fetch(
      "https://api-m.paypal.com/v1/oauth2/token",
      {
        method:
          "POST",

        headers: {
          Authorization:
            "Basic " +
            authorization,

          "Content-Type":
            "application/x-www-form-urlencoded"
        },

        body:
          "grant_type=client_credentials"
      }
    );

  const data =
    await response.json();

  if (
    !response.ok ||
    !data.access_token
  ) {
    throw new Error(
      data?.error_description ||
      "PayPal authentication failed."
    );
  }

  return data.access_token;
}


async function getPayPalOrder(
  orderId
) {
  const accessToken =
    await getPayPalAccessToken();

  const response =
    await fetch(
      "https://api-m.paypal.com/v2/checkout/orders/" +
      encodeURIComponent(
        orderId
      ),
      {
        method:
          "GET",

        headers: {
          Authorization:
            "Bearer " +
            accessToken,

          Accept:
            "application/json"
        },

        cache:
          "no-store"
      }
    );

  const data =
    await response.json();

  if (!response.ok) {
    throw new Error(
      data?.message ||
      "PayPal could not verify this order."
    );
  }

  return data;
}


function makePayPalRequestId(
  type,
  reservationId
) {
  return crypto
    .createHash(
      "sha256"
    )
    .update(
      type +
      ":" +
      reservationId
    )
    .digest(
      "hex"
    )
    .slice(
      0,
      36
    );
}


/*
=====================================================
VALIDATE PAYPAL RESERVATION
=====================================================
*/

async function validatePayPalReservation(
  googleToken,
  paymentData
) {
  const settings =
    await getSettings(
      googleToken
    );

  const email =
    String(
      paymentData?.email || ""
    )
      .trim()
      .toLowerCase();

  const reservationId =
    String(
      paymentData?.reservationId || ""
    ).trim();

  const squares =
    normalizeSquareList(
      paymentData?.squares
    );

  if (
    !email ||
    !reservationId
  ) {
    throw new Error(
      "PayPal reservation information is incomplete."
    );
  }

  let rows =
    await getAllRows(
      googleToken
    );

  await releaseExpiredReservations(
    googleToken,
    rows,
    settings.holdMinutes
  );

  rows =
    await getAllRows(
      googleToken
    );

  squares.forEach(
    function(squareNumber) {

      const row =
        rows[
          squareNumber - 1
        ];

      if (
        normalizeStatus(
          row[1]
        ) !== "Pending"
      ) {
        throw new Error(
          "Square " +
          squareNumber +
          " is no longer pending."
        );
      }

      const reservedEmail =
        String(
          row[3] || ""
        )
          .trim()
          .toLowerCase();

      if (
        reservedEmail !==
        email
      ) {
        throw new Error(
          "The reservation email does not match."
        );
      }

      const savedReservationId =
        String(
          row[11] || ""
        ).trim();

      if (
        savedReservationId !==
        reservationId
      ) {
        throw new Error(
          "The reservation ID does not match."
        );
      }
    }
  );

  return {
    rows:
      rows,

    squares:
      squares,

    email:
      email,

    reservationId:
      reservationId,

    settings:
      settings,

    total:
      squares.length *
      settings.pricePerSquare
  };
}


/*
=====================================================
CREATE PAYPAL ORDER
=====================================================
*/

async function createPayPalOrder(
  googleToken,
  paymentData
) {
  const reservation =
    await validatePayPalReservation(
      googleToken,
      paymentData
    );

  const accessToken =
    await getPayPalAccessToken();

  const requestId =
    makePayPalRequestId(
      "create",
      reservation.reservationId
    );

  const response =
    await fetch(
      "https://api-m.paypal.com/v2/checkout/orders",
      {
        method:
          "POST",

        headers: {
          Authorization:
            "Bearer " +
            accessToken,

          "Content-Type":
            "application/json",

          "PayPal-Request-Id":
            requestId,

          Prefer:
            "return=representation"
        },

        body:
          JSON.stringify({
            intent:
              "CAPTURE",

            purchase_units: [
              {
                custom_id:
                  reservation.reservationId,

                description:
                  "Akron Rescue Cats Preseason Game 3 Football Squares: " +
                  reservation.squares.join(", "),

                amount: {
                  currency_code:
                    CURRENCY_CODE,

                  value:
                    reservation.total
                      .toFixed(2)
                }
              }
            ]
          })
      }
    );

  const data =
    await response.json();

  if (
    !response.ok ||
    !data.id
  ) {
    throw new Error(
      data?.message ||
      data?.details?.[0]?.description ||
      "PayPal could not create the order."
    );
  }

  return {
    success:
      true,

    orderId:
      data.id
  };
}


/*
=====================================================
VERIFY PAYPAL
=====================================================
*/

function verifyCompletedPayPalOrder(
  paypalOrder,
  expectedTotal,
  reservationId
) {
  if (
    String(
      paypalOrder?.status || ""
    ).toUpperCase() !==
    "COMPLETED"
  ) {
    throw new Error(
      "The PayPal payment is not completed."
    );
  }

  const purchaseUnits =
    Array.isArray(
      paypalOrder.purchase_units
    )
      ? paypalOrder.purchase_units
      : [];

  let paidTotal = 0;

  let reservationMatches =
    false;

  purchaseUnits.forEach(
    function(unit) {

      if (
        String(
          unit.custom_id || ""
        ) ===
        reservationId
      ) {
        reservationMatches =
          true;
      }

      const captures =
        unit?.payments?.captures;

      if (
        !Array.isArray(captures)
      ) {
        return;
      }

      captures.forEach(
        function(capture) {

          if (
            String(
              capture.status || ""
            ).toUpperCase() !==
            "COMPLETED"
          ) {
            return;
          }

          const currency =
            String(
              capture
                ?.amount
                ?.currency_code ||
              ""
            ).toUpperCase();

          if (
            currency !==
            CURRENCY_CODE
          ) {
            throw new Error(
              "The PayPal payment currency is incorrect."
            );
          }

          paidTotal +=
            Number(
              capture
                ?.amount
                ?.value ||
              0
            );
        }
      );
    }
  );

  if (
    !reservationMatches
  ) {
    throw new Error(
      "The PayPal payment does not match this reservation."
    );
  }

  if (
    Math.round(
      paidTotal * 100
    ) !==
    Math.round(
      expectedTotal * 100
    )
  ) {
    throw new Error(
      "The PayPal payment amount does not match the reservation."
    );
  }
}


/*
=====================================================
CAPTURE PAYPAL
=====================================================
*/

async function capturePayPalOrder(
  googleToken,
  paymentData
) {
  const orderId =
    String(
      paymentData?.orderId || ""
    ).trim();

  if (!orderId) {
    throw new Error(
      "The PayPal order ID is missing."
    );
  }

  const currentRows =
    await getAllRows(
      googleToken
    );

  const alreadyPaid =
    currentRows.some(
      function(row) {

        return (
          String(
            row[8] || ""
          ) === orderId &&

          String(
            row[7] || ""
          )
            .trim()
            .toLowerCase() ===
            "paid"
        );
      }
    );

  if (
    alreadyPaid
  ) {
    return {
      success:
        true,

      alreadyProcessed:
        true,

      orderId:
        orderId
    };
  }

  const reservation =
    await validatePayPalReservation(
      googleToken,
      paymentData
    );

  const accessToken =
    await getPayPalAccessToken();

  const requestId =
    makePayPalRequestId(
      "capture",
      reservation.reservationId
    );

  const response =
    await fetch(
      "https://api-m.paypal.com/v2/checkout/orders/" +
      encodeURIComponent(
        orderId
      ) +
      "/capture",
      {
        method:
          "POST",

        headers: {
          Authorization:
            "Bearer " +
            accessToken,

          "Content-Type":
            "application/json",

          "PayPal-Request-Id":
            requestId,

          Prefer:
            "return=representation"
        },

        body:
          "{}"
      }
    );

  const captureResult =
    await response.json();

  let paypalOrder;

  try {
    paypalOrder =
      await getPayPalOrder(
        orderId
      );
  } catch (error) {
    paypalOrder =
      captureResult;
  }

  if (
    !response.ok &&
    String(
      paypalOrder?.status || ""
    ).toUpperCase() !==
      "COMPLETED"
  ) {
    throw new Error(
      captureResult?.message ||
      captureResult
        ?.details?.[0]
        ?.description ||
      "PayPal could not capture the payment."
    );
  }

  verifyCompletedPayPalOrder(
    paypalOrder,
    reservation.total,
    reservation.reservationId
  );

  const paymentDate =
    new Date()
      .toISOString();

  const updates = [];

  reservation.squares.forEach(
    function(squareNumber) {

      const row =
        reservation.rows[
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
          "PayPal",
          "Paid",
          orderId,
          reservation.settings
            .pricePerSquare,
          paymentDate,
          reservation.reservationId
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

    orderId:
      orderId,

    squares:
      reservation.squares,

    amount:
      reservation.total
  };
}


/*
=====================================================
ZEFFY / VENMO
=====================================================
*/

async function savePaymentMethod(
  googleToken,
  paymentData
) {
  const settings =
    await getSettings(
      googleToken
    );

  const email =
    String(
      paymentData?.email || ""
    )
      .trim()
      .toLowerCase();

  const method =
    String(
      paymentData?.paymentMethod ||
      ""
    )
      .trim()
      .toLowerCase();

  const squares =
    normalizeSquareList(
      paymentData?.squares
    );

  if (
    method !== "zeffy" &&
    method !== "venmo"
  ) {
    throw new Error(
      "That payment method is not valid."
    );
  }

  if (!email) {
    throw new Error(
      "Reservation email is missing."
    );
  }

  let rows =
    await getAllRows(
      googleToken
    );

  await releaseExpiredReservations(
    googleToken,
    rows,
    settings.holdMinutes
  );

  rows =
    await getAllRows(
      googleToken
    );

  const updates = [];

  squares.forEach(
    function(squareNumber) {

      const row =
        rows[
          squareNumber - 1
        ];

      if (
        normalizeStatus(
          row[1]
        ) !== "Pending"
      ) {
        throw new Error(
          "Square " +
          squareNumber +
          " is no longer pending."
        );
      }

      const reservedEmail =
        String(
          row[3] || ""
        )
          .trim()
          .toLowerCase();

      if (
        reservedEmail !==
        email
      ) {
        throw new Error(
          "The reservation email does not match."
        );
      }

      const sheetRow =
        squareNumber + 1;

      updates.push({
        range:
          `${SHEET_NAME}!G${sheetRow}:H${sheetRow}`,

        values: [[
          method === "zeffy"
            ? "Zeffy"
            : "Venmo",

          "Payment Pending"
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

    paymentMethod:
      method,

    squares:
      squares
  };
}


/*
=====================================================
MAIN API
=====================================================
*/

export default {

  async fetch(request) {

    try {

      const token =
        await getAccessToken();

      const settings =
        await getSettings(
          token
        );


      /*
      GET BOARD
      */

      if (
        request.method ===
        "GET"
      ) {

        let rows =
          await getAllRows(
            token
          );

        await releaseExpiredReservations(
          token,
          rows,
          settings.holdMinutes
        );

        rows =
          await getAllRows(
            token
          );

        return Response.json({
          success:
            true,

          settings:
            settings,

          squares:
            rowsToPublicSquares(
              rows
            )
        });
      }


      /*
      POST ACTIONS
      */

      if (
        request.method ===
        "POST"
      ) {

        const body =
          await request.json();


        if (
          body.action ===
          "reserveSquares"
        ) {
          return Response.json(
            await reserveSquares(
              token,
              body.data
            )
          );
        }


        if (
          body.action ===
          "createPayPalOrder"
        ) {
          return Response.json(
            await createPayPalOrder(
              token,
              body.data
            )
          );
        }


        if (
          body.action ===
          "capturePayPalOrder"
        ) {
          return Response.json(
            await capturePayPalOrder(
              token,
              body.data
            )
          );
        }


        if (
          body.action ===
          "savePaymentMethod"
        ) {
          return Response.json(
            await savePaymentMethod(
              token,
              body.data
            )
          );
        }


        return Response.json(
          {
            success:
              false,

            message:
              "Invalid API action."
          },
          {
            status:
              400
          }
        );
      }


      return Response.json(
        {
          success:
            false,

          message:
            "Method not allowed."
        },
        {
          status:
            405
        }
      );


    } catch (error) {

      console.error(
        "Preseason Game 3 API error:",
        error
      );

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
