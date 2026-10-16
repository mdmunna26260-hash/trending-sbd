import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { parseIdParam } from "@/lib/admin-id";
import { logAudit } from "@/lib/auth";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/* SECURITY (server-side RBAC):
   1. Only SUPER_ADMIN (role re-read from DB, token not trusted) may update
      users — role, status, or password included.
   2. Nobody can change their OWN role, own status, or own password through
      this endpoint (self-escalation path closed).
   3. The last active SUPER_ADMIN cannot be downgraded/deactivated.
   Every check runs immediately before the DB mutation. */

async function requireSuperAdmin(req?: Request) {
  const g = await requirePerm("users", req);
  if ("res" in g) return g;
  const dbUser = await db.user.findUnique({ where: { id: g.user.id }, select: { role: true, active: true } });
  if (!dbUser?.active || dbUser.role !== "SUPER_ADMIN") {
    return { res: NextResponse.json({ error: "You do not have permission to manage team members." }, { status: 403 }) };
  }
  return { user: g.user };
}

async function countOtherActiveSuperAdmins(excludeId: number): Promise<number> {
  return db.user.count({ where: { role: "SUPER_ADMIN", active: true, id: { not: excludeId } } });
}

export async function PUT(req: Request, props: Ctx) {
  const params = await props.params;
  const g = await requireSuperAdmin(req);
  if ("res" in g) return g.res;
  const id = parseIdParam(params.id);
  if (id === null) return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
  const target = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true, active: true } });
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const b = await req.json();
  const data: any = {};

  // SELF-MODIFICATION GUARD: you can never change your own role/status/password, and
  // never delete/degrade the account you are logged in with via this API.
  if (id === g.user.id && (b.role !== undefined || b.active !== undefined || b.password !== undefined)) {
    return NextResponse.json({ error: "You cannot change your own role, status or password through team management." }, { status: 403 });
  }

  if (b.role !== undefined) {
    if (!["SUPER_ADMIN", "ADMIN", "ORDER_MANAGER", "PRODUCT_MANAGER", "MARKETING", "SUPPORT"].includes(b.role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }
    if (b.role !== target.role) {
      // LAST SUPER_ADMIN SAFETY: downgrading the final active SUPER_ADMIN is blocked
      if (target.role === "SUPER_ADMIN" && target.active && (await countOtherActiveSuperAdmins(id)) === 0) {
        return NextResponse.json({ error: "Cannot downgrade the last SUPER_ADMIN — create another SUPER_ADMIN first." }, { status: 400 });
      }
      data.role = b.role;
    }
  }

  if (b.active !== undefined) {
    const nextActive = !!b.active;
    if (nextActive !== target.active) {
      // deactivating the final active SUPER_ADMIN is blocked
      if (target.role === "SUPER_ADMIN" && target.active && !nextActive && (await countOtherActiveSuperAdmins(id)) === 0) {
        return NextResponse.json({ error: "Cannot deactivate the last SUPER_ADMIN." }, { status: 400 });
      }
      data.active = nextActive;
    }
  }

  if (b.name) data.name = String(b.name).slice(0, 80);
  if (b.password) {
    if (String(b.password).length < 6) return NextResponse.json({ error: "Password too short" }, { status: 400 });
    data.password = await bcrypt.hash(b.password, 10);
  }

  if (Object.keys(data).length === 0) return NextResponse.json({ ok: true });
  // Changing credentials or privileges revokes previously issued sessions.
  if (data.password || data.role !== undefined || data.active !== undefined) data.sessionVersion = { increment: 1 };
  await db.user.update({ where: { id }, data });
  await logAudit(g.user.email, "USER_UPDATED", `user #${id} (${target.email}) → ${JSON.stringify({ role: data.role, active: data.active, password: !!data.password })}`);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, props: Ctx) {
  const params = await props.params;
  const g = await requireSuperAdmin(req);
  if ("res" in g) return g.res;
  const id = parseIdParam(params.id);
  if (id === null) return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
  if (id === g.user.id) return NextResponse.json({ error: "You cannot delete yourself" }, { status: 400 });
  const target = await db.user.findUnique({ where: { id }, select: { role: true, active: true, email: true } });
  if (!target) return NextResponse.json({ ok: true });
  if (target.role === "SUPER_ADMIN" && (await countOtherActiveSuperAdmins(id)) === 0) {
    return NextResponse.json({ error: "Cannot delete the last SUPER_ADMIN." }, { status: 400 });
  }
  const u = await db.user.delete({ where: { id } }).catch(() => null);
  if (u) await logAudit(g.user.email, "USER_DELETED", u.email);
  return NextResponse.json({ ok: true });
}
