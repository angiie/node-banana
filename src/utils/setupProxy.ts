import { ProxyAgent, setGlobalDispatcher } from "undici";

let configured = false;

export function setupProxy() {
  if (configured) {
    return;
  }

  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;

  if (!proxyUrl) {
    return;
  }

  const agent = new ProxyAgent(proxyUrl);
  setGlobalDispatcher(agent);
  configured = true;
}

