import { signOutAction } from "@/app/actions/auth";
import { Button } from "@kiakia/ui";

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <Button type="submit" variant="secondary" className="w-full">
        Log Out
      </Button>
    </form>
  );
}
