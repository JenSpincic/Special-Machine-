import { getAuthedUser } from "./_clerk-auth.mjs";

export default async (req) => {
  const user = await getAuthedUser(req);
  if (!user) {
    return new Response(JSON.stringify({ error: "Not signed in" }), { status: 401 });
  }
  return new Response(JSON.stringify(user), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
