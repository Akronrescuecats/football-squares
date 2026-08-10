import crypto from "crypto";

function base64Url(input) {
  return Buffer
    .from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function getAccessToken() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!email || !privateKey) {
    throw new Error("Google service account credentials are missing.");
  }

  const now = Math.floor(Date.now() / 1000);

  const header = {
    alg: "RS256",
    typ: "JWT"
  };

  const claimSet = {
    iss: email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now
  };

  const unsignedToken =
    base64Url(JSON.stringify(header)) +
    "." +
    base64Url(JSON.stringify(claimSet));

  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsignedToken);
  signer.end();

  const signature = signer.sign(privateKey);

  const jwt =
    unsignedToken +
    "." +
    base64Url(signature);

  const tokenResponse = await fetch(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type:
          "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt
      })
    }
  );

  const tokenData = await tokenResponse.json();

  if (!tokenResponse.ok || !tokenData.access_token) {
    throw new Error(
      tokenData.error_description ||
      "Could not authenticate with Google."
    );
  }

  return tokenData.access_token;
}

async function getSquares() {
  const spreadsheetId =
    process.env.PRESEASON_SPREADSHEET_ID;

  if (!spreadsheetId) {
    throw new Error(
      "PRESEASON_SPREADSHEET_ID is missing."
    );
  }

  const accessToken = await getAccessToken();

  const range = encodeURIComponent(
    "Squares!A2:C101"
  );

  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/` +
    `${spreadsheetId}/values/${range}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
      "Could not read the football squares sheet."
    );
  }

  const rows = data.values || [];

  return rows
    .map(function(row) {
      return {
        square: Number(row[0]),
        status: row[1] || "Available",
        name: row[2] || ""
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

      const squares = await getSquares();

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
