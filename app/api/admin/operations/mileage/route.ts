import {
  accountRequest,
  accountJson,
  accountFailure,
  readAccountJson,
} from "@/lib/account-api";
import { readRouteMileage, saveRouteMileage } from "@/lib/services/route-mileage";
import { z } from "zod";
export async function GET(r: Request) {
  try {
    const id = z
      .string()
      .min(1)
      .max(100)
      .parse(new URL(r.url).searchParams.get("routeId"));
    return accountJson(await readRouteMileage(await accountRequest(), id));
  } catch (e) {
    return accountFailure(e);
  }
}
export async function POST(r: Request) {
  try {
    return accountJson(
      await saveRouteMileage(await accountRequest(r), await readAccountJson(r)),
    );
  } catch (e) {
    return accountFailure(e);
  }
}
