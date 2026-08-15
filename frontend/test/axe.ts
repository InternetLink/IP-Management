import axe from "axe-core";
import type {AxeResults} from "axe-core";

export function runAxe(container: Element): Promise<AxeResults> {
  return axe.run(container);
}
