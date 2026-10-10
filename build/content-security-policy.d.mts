export function createContentSecurityPolicyPlugin(command: 'serve' | 'build'): {
  name: string
  transformIndexHtml: {
    order: 'post'
    handler(html: string): string
  }
}
