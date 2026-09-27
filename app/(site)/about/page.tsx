import { redirect } from "next/navigation";

/** The manifesto lives on the home page now; old /about links land on it. */
export default function AboutPage() {
  redirect("/#manifesto");
}
