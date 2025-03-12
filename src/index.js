addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event.request, event));
});

async function handleRequest(request, event) {
  const { method, url } = request;
  const { pathname } = new URL(url);

  // Função auxiliar para respostas JSON
  const jsonResponse = (data, status = 200) =>
    new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json" },
      status,
    });

  // Autenticação com token no KV
  const auth = async () => {
    const token = request.headers.get("Authorization");
    if (!token) return jsonResponse({ error: "Token faltando" }, 401);
    const userId = await event.env.CACHE.get(`token:${token}`);
    if (!userId) return jsonResponse({ error: "Token inválido" }, 401);
    return parseInt(userId);
  };

  // POST /api/register
  if (method === "POST" && pathname === "/api/register") {
    const { name, email, password } = await request.json();
    if (!name || !email || !password)
      return jsonResponse({ error: "Dados incompletos" }, 400);
    try {
      const user = await event.env.DB.prepare(
        "INSERT INTO users (name, email, password) VALUES (?, ?, ?)"
      )
        .bind(name, email, password) // Em produção, use hash!
        .run();
      const token = crypto.randomUUID();
      await event.env.CACHE.put(`token:${token}`, user.lastInsertRowid, {
        expirationTtl: 86400,
      }); // 1 dia
      return jsonResponse({ token });
    } catch (e) {
      return jsonResponse({ error: "Email já existe" }, 409);
    }
  }

  // POST /api/login
  if (method === "POST" && pathname === "/api/login") {
    const { email, password } = await request.json();
    const user = await event.env.DB.prepare(
      "SELECT id FROM users WHERE email = ? AND password = ?"
    )
      .bind(email, password)
      .first();
    if (!user) return jsonResponse({ error: "Credenciais inválidas" }, 401);
    const token = crypto.randomUUID();
    await event.env.CACHE.put(`token:${token}`, user.id, {
      expirationTtl: 86400,
    });
    return jsonResponse({ token });
  }

  // Rotas protegidas
  const userId = await auth();
  if (!userId) return;

  // CRUD Clientes
  if (pathname.startsWith("/api/customers")) {
    if (method === "GET" && pathname === "/api/customers") {
      const { results } = await event.env.DB.prepare(
        "SELECT * FROM customers WHERE user_id = ?"
      )
        .bind(userId)
        .all();
      return jsonResponse(results);
    }
    if (method === "POST" && pathname === "/api/customers") {
      const { name, email, phone } = await request.json();
      if (!name || !email)
        return jsonResponse({ error: "Nome e email obrigatórios" }, 400);
      try {
        await event.env.DB.prepare(
          "INSERT INTO customers (user_id, name, email, phone) VALUES (?, ?, ?, ?)"
        )
          .bind(userId, name, email, phone || "")
          .run();
        return jsonResponse({ message: "Cliente criado" }, 201);
      } catch (e) {
        return jsonResponse({ error: "Email já existe" }, 409);
      }
    }
    if (method === "PUT" && pathname.match(/\/api\/customers\/\d+/)) {
      const id = pathname.split("/").pop();
      const { name, email, phone } = await request.json();
      await event.env.DB.prepare(
        "UPDATE customers SET name = ?, email = ?, phone = ? WHERE id = ? AND user_id = ?"
      )
        .bind(name || "", email || "", phone || "", id, userId)
        .run();
      return jsonResponse({ message: "Cliente atualizado" });
    }
    if (method === "DELETE" && pathname.match(/\/api\/customers\/\d+/)) {
      const id = pathname.split("/").pop();
      await event.env.DB.prepare(
        "DELETE FROM orders WHERE customer_id = ? AND user_id = ?"
      )
        .bind(id, userId)
        .run();
      await event.env.DB.prepare(
        "DELETE FROM customers WHERE id = ? AND user_id = ?"
      )
        .bind(id, userId)
        .run();
      return jsonResponse({ message: "Cliente deletado" });
    }
  }

  // CRUD Pedidos
  if (pathname.startsWith("/api/orders")) {
    if (method === "GET" && pathname === "/api/orders") {
      const { results } = await event.env.DB.prepare(
        "SELECT o.*, c.name AS customer_name FROM orders o JOIN customers c ON o.customer_id = c.id WHERE o.user_id = ?"
      )
        .bind(userId)
        .all();
      return jsonResponse(results);
    }
    if (method === "POST" && pathname === "/api/orders") {
      const { customer_id, description, value } = await request.json();
      if (!customer_id || !description || !value)
        return jsonResponse({ error: "Dados incompletos" }, 400);
      await event.env.DB.prepare(
        "INSERT INTO orders (customer_id, user_id, description, value) VALUES (?, ?, ?, ?)"
      )
        .bind(customer_id, userId, description, value)
        .run();
      await event.env.CACHE.delete(`report:${userId}`);
      return jsonResponse({ message: "Pedido criado" }, 201);
    }
    if (method === "PUT" && pathname.match(/\/api\/orders\/\d+/)) {
      const id = pathname.split("/").pop();
      const { description, value, status } = await request.json();
      await event.env.DB.prepare(
        "UPDATE orders SET description = ?, value = ?, status = ? WHERE id = ? AND user_id = ?"
      )
        .bind(description || "", value || 0, status || "pending", id, userId)
        .run();
      await event.env.CACHE.delete(`report:${userId}`);
      return jsonResponse({ message: "Pedido atualizado" });
    }
    if (method === "DELETE" && pathname.match(/\/api\/orders\/\d+/)) {
      const id = pathname.split("/").pop();
      await event.env.DB.prepare(
        "DELETE FROM orders WHERE id = ? AND user_id = ?"
      )
        .bind(id, userId)
        .run();
      await event.env.CACHE.delete(`report:${userId}`);
      return jsonResponse({ message: "Pedido deletado" });
    }
  }

  // Relatório
  if (method === "GET" && pathname === "/api/report") {
    const cacheKey = `report:${userId}`;
    const cached = await event.env.CACHE.get(cacheKey);
    if (cached) return jsonResponse(JSON.parse(cached));
    const { results } = await event.env.DB.prepare(
      "SELECT status, COUNT(*) as count, SUM(value) as total FROM orders WHERE user_id = ? GROUP BY status"
    )
      .bind(userId)
      .all();
    await event.env.CACHE.put(cacheKey, JSON.stringify(results), {
      expirationTtl: 3600,
    });
    return jsonResponse(results);
  }

  return jsonResponse({ message: "CustomerSync API" });
}
