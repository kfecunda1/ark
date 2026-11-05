import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PATHS = [
  "/dashboard",
  "/projects",
  "/receivers",
  "/people",
  "/notes",
  "/activity",
  "/settings",
  "/change-password",
];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Do not remove: this refreshes the auth token via a Supabase server call
  // and must run before any decision based on the session is made.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  );

  if (!user && isProtected) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  // A forced password change (a brand-new account, or an admin-
  // triggered reset — Settings → Users) locks the user out of
  // everything else until they clear it themselves via
  // app/change-password/page.tsx. A deactivated user needs no such
  // check here: is_registered_user() requiring active = true already
  // makes this query (and everything else) return nothing for them.
  if (user && isProtected && pathname !== "/change-password") {
    const { data: profile } = await supabase
      .from("profiles")
      .select("must_change_password")
      .eq("id", user.id)
      .maybeSingle();
    if ((profile as { must_change_password: boolean } | null)?.must_change_password) {
      return NextResponse.redirect(new URL("/change-password", request.url));
    }
  }

  return response;
}
