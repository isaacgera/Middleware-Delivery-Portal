# IIS reverse proxy for MDP (Windows server)

If the BT server runs **IIS** (likely, given it's Windows), use IIS as the TLS front and reverse-
proxy to the Node app on `127.0.0.1:4000`. This mirrors what `nginx-mdp.conf` does, the IIS way.

## One-time IIS setup
1. Install the **URL Rewrite** module and **Application Request Routing (ARR)** (both from the
   IIS/Web Platform downloads, or your BT-standard installer).
2. In IIS Manager → server node → **Application Request Routing Cache** → *Server Proxy Settings*
   → tick **Enable proxy**.
3. Create a **site** bound to **https** on 443 with the **BT TLS certificate** (Bindings → Add →
   https → select the cert). Add an **http:80** binding too (for the redirect below).

## web.config for the site
Place this `web.config` at the site root. It forwards everything to the Node app and redirects
HTTP→HTTPS. (The Node app stays on loopback `127.0.0.1:4000`, started as a service — see
`run-as-service-windows.md`.)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <!-- 1) Force HTTPS -->
        <rule name="HTTP to HTTPS" stopProcessing="true">
          <match url="(.*)" />
          <conditions>
            <add input="{HTTPS}" pattern="off" ignoreCase="true" />
          </conditions>
          <action type="Redirect" url="https://{HTTP_HOST}/{R:1}" redirectType="Permanent" />
        </rule>

        <!-- 2) Reverse-proxy everything to the Node app on loopback -->
        <rule name="ReverseProxyToNode" stopProcessing="true">
          <match url="(.*)" />
          <conditions>
            <add input="{HTTPS}" pattern="on" ignoreCase="true" />
          </conditions>
          <action type="Rewrite" url="http://127.0.0.1:4000/{R:1}" />
          <serverVariables>
            <!-- Tell the app it's behind HTTPS so cookies/behaviour are correct -->
            <set name="HTTP_X_FORWARDED_PROTO" value="https" />
          </serverVariables>
        </rule>
      </rules>
    </rewrite>

    <!-- Allow setting the X-Forwarded-Proto server variable in the rewrite rule above.
         (Also add it under IIS Manager → URL Rewrite → View Server Variables.) -->
    <security>
      <requestFiltering>
        <!-- Menu Card .xlsx uploads: allow ~20 MB (app guards at 15 MB). 20971520 bytes. -->
        <requestLimits maxAllowedContentLength="20971520" />
      </requestFiltering>
    </security>
  </system.webServer>
</configuration>
```

## Notes
- **ARR must be enabled** (step 2) or the Rewrite→`http://127.0.0.1:4000` action returns 404.
- The allowed server variable `HTTP_X_FORWARDED_PROTO` must be added once in **URL Rewrite → View
  Server Variables → Add** (IIS blocks arbitrary server variables otherwise).
- Keep the Node app bound to **127.0.0.1** so it's only reachable via IIS, not directly.
- Health probe for monitoring: `https://<host>/api/health`.
