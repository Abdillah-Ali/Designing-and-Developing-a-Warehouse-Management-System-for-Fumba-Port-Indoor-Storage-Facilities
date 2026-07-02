import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AuthenticatedUserBadge } from "./AuthenticatedUserBadge";
import { clearStoredAuthToken, setStoredAuthToken } from "@/lib/portal-access";

function createUnsignedBrowserToken(payload) {
  const encoded = btoa(JSON.stringify(payload))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return `e30.${encoded}.signature`;
}

function renderBadge() {
  return render(
    <MemoryRouter>
      <AuthenticatedUserBadge />
    </MemoryRouter>
  );
}

describe("AuthenticatedUserBadge", () => {
  afterEach(() => {
    clearStoredAuthToken();
    vi.unstubAllGlobals();
  });

  it("does not display user information without an authenticated token", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { container } = renderBadge();

    expect(container).toBeEmptyDOMElement();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("displays the authenticated user's name and role from the profile API", async () => {
    setStoredAuthToken(createUnsignedBrowserToken({
      role: "Supervisor",
      exp: Math.floor(Date.now() / 1000) + 60
    }));

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          user: {
            full_name: "Abdillah Ali",
            role_name: "Supervisor",
            warehouse_name: "Warehouse A"
          }
        }
      })
    }));

    renderBadge();

    expect(await screen.findByText("Abdillah Ali")).toBeInTheDocument();
    expect(screen.getByText("Warehouse Supervisor")).toBeInTheDocument();
    expect(screen.getByText("Warehouse A")).toBeInTheDocument();
  });

  it("opens the requested account menu without extra session items", async () => {
    setStoredAuthToken(createUnsignedBrowserToken({
      role: "System Admin",
      exp: Math.floor(Date.now() / 1000) + 60
    }));

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          user: {
            full_name: "Asha Juma",
            role_name: "System Admin"
          }
        }
      })
    }));

    renderBadge();

    const accountButton = await screen.findByRole("button", { name: /signed in as asha juma/i });
    fireEvent.click(accountButton);

    expect(screen.getByRole("menuitem", { name: /my profile/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /change password/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /logout/i })).toBeInTheDocument();
    expect(screen.queryByText(/activity log/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/online/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/session/i)).not.toBeInTheDocument();
  });

  it("opens change password in a popup window with password visibility controls", async () => {
    setStoredAuthToken(createUnsignedBrowserToken({
      role: "Warehouse Staff",
      exp: Math.floor(Date.now() / 1000) + 60
    }));

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          user: {
            full_name: "Asha Juma",
            role_name: "Warehouse Staff",
            warehouse_name: "Warehouse A"
          }
        }
      })
    }));

    renderBadge();

    fireEvent.click(await screen.findByRole("button", { name: /signed in as asha juma/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /change password/i }));

    expect(screen.getByRole("dialog", { name: /change password/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/show current password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/show new password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/show confirm new password/i)).toBeInTheDocument();
  });
});
