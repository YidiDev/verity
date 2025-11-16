# Transport Options

Verity is transport-agnostic. You can use SSE (default), WebSocket, GraphQL subscriptions, or build your own.

---

## SSE (Default)

**Pros:**
- Simple HTTP
- Auto-reconnect built-in
- Works through most proxies

**Cons:**
- Unidirectional (server → client)
- Best-effort delivery

---

## WebSocket (Custom Adapter)

**Pros:**
- Bidirectional
- Lower latency

**Cons:**
- More complex
- Proxy issues

---

## GraphQL Subscriptions (Custom Adapter)

**Pros:**
- Leverages existing GraphQL infra
- Type-safe subscriptions

**Cons:**
- Requires GraphQL server

**How to implement:**
```javascript
registry.configureDirectiveSource({
  type: 'graphql-subscription',
  connect: ({ applyDirectives, clientId }) => {
    const subscription = gqlClient.subscribe({
      query: DIRECTIVES_SUBSCRIPTION,
      variables: { clientId }
    })
    
    subscription.on('data', ({ directives, source }) => {
      if (source !== clientId) {
        applyDirectives(directives)
      }
    })
    
    return () => subscription.unsubscribe()
  }
})
```

---

## Next Steps

1. Master [Truth-State vs View-State](../concepts/truth-vs-view-state.md) distinction
2. Learn the [Directive Contract](../concepts/directives.md)
3. Understand [Levels & Conversions](../concepts/levels-and-conversions.md)
4. Study [Concurrency Model](../concepts/concurrency-model.md)
5. Follow [Getting Started](../guides/getting-started.md) to implement this architecture
