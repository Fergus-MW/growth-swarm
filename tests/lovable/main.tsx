import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { getRouter } from "../../src/router";
import { routeTree } from "../../src/routeTree.gen";
import "../../src/styles.css";
import "./runtime";

routeTree.update({ shellComponent: ({ children }) => children, head: () => ({}) });
const router = getRouter();
createRoot(document.getElementById("root")!).render(<RouterProvider router={router} />);
