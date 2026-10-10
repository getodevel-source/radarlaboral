const viteDevelopmentConnectSources = /connect-src 'self' http:\/\/127\.0\.0\.1:5173 ws:\/\/127\.0\.0\.1:5173;/gu

export function createContentSecurityPolicyPlugin(command) {
  return {
    name: 'radar-content-security-policy',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        if (command !== 'build') return html

        const matches = [...html.matchAll(viteDevelopmentConnectSources)]
        if (matches.length !== 1) {
          throw new Error(`Expected one Vite development connect-src directive, found ${matches.length}`)
        }

        return html.replace(viteDevelopmentConnectSources, "connect-src 'self';")
      },
    },
  }
}
