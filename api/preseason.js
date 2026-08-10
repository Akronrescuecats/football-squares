export default async function handler(req, res) {
  const SCRIPT_URL = process.env.PRESEASON_SCRIPT_URL;

  if (!SCRIPT_URL) {
    return res.status(500).json({
      success: false,
      message: 'PRESEASON_SCRIPT_URL is missing.'
    });
  }

  try {
    const url =
      SCRIPT_URL + '?action=getSquares';

    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow'
    });

    const text = await response.text();

    return res.status(200).json({
      success: true,
      googleStatus: response.status,
      finalUrl: response.url,
      contentType: response.headers.get('content-type'),
      first500Characters: text.substring(0, 500)
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || String(error)
    });
  }
}
      const response = await fetch(url, {
        redirect: 'follow'
      });

      const text = await response.text();

      let data;

      try {
        data = JSON.parse(text);
      } catch (error) {
        return res.status(502).json({
          success: false,
          message: 'Google returned an invalid response.'
        });
      }

      return res.status(200).json(data);
    }

    if (req.method === 'POST') {
      const response = await fetch(SCRIPT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8'
        },
        body: JSON.stringify(req.body),
        redirect: 'follow'
      });

      const text = await response.text();

      let data;

      try {
        data = JSON.parse(text);
      } catch (error) {
        return res.status(502).json({
          success: false,
          message: 'Google returned an invalid response.'
        });
      }

      return res.status(200).json(data);
    }

    return res.status(405).json({
      success: false,
      message: 'Method not allowed.'
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message:
        error.message ||
        'The preseason board could not connect.'
    });
  }
}
