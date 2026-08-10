import crypto from "crypto";

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

  try {
    const credentials = JSON.parse(raw);

    if (
      !credentials.client_email ||
      !credentials.private_key
    ) {
      throw new Error(
        "The Google credential is missing the email or private key."
      );
    }

    return credentials;

  } catch (error) {
    throw new Error(
      "The Google service account JSON could not be read."
    );
  }
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
    base64Url(JSON.stringify(header)) +
    "." +
    base64Url(JSON.stringify(claims));

  const privateKey =
    crypto.createPrivateKey({
      key: credentials.private_key,
      format: "pem"
    });

  const signature =
    crypto.sign(
      "RSA-SHA256",
      Buffer.from(unsignedToken),
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

            assertion: jwt
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

async function getSquares() {
  const spreadsheetId =
    process.env.PRESEASON_SPREADSHEET_ID;

  if (!spreadsheetId) {
    throw new Error(
      "PRESEASON_SPREADSHEET_ID is missing."
    );
  }

  const token =
    await getAccessToken();

  const range =
    encodeURIComponent(
      "Squares!A2:C101"
    );

  const url =
    "https://sheets.googleapis.com/v4/spreadsheets/" +
    spreadsheetId +
    "/values/" +
    range;

  const response =
    await fetch(url, {
      headers: {
        Authorization:
          "Bearer " + token
      }
    });

  const data =
    await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
      "Could not read the football squares sheet."
    );
  }

  const rows =
    data.values || [];

  return rows
    .map(function(row) {
      return {
        square: Number(row[0]),
        status:
          row[1] || "Available",
        name:
          row[2] || ""
      };
    })
    .filter(function(item) {
      return (
        Number.isInteger(item.square) &&
        item.square >= 1 &&
        item.square <= 100
      );
    })
    .sort(function(a, b) {
      return a.square - b.square;
    });
}

export default {
  async fetch(request) {
    try {
      if (request.method !== "GET") {
        return Response.json(
          {
            success: false,
            message: "Method not allowed."
          },
          { status: 405 }
        );
      }

      const squares =
        await getSquares();

      return Response.json({
        success: true,
        squares: squares
      });

    } catch (error) {
      return Response.json(
        {
          success: false,
          message:
            error?.message ||
            String(error)
        },
        { status: 500 }
      );
    }
  }
};
