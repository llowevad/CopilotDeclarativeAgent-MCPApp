function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value ?? {}, key);
}

export function isAnswerPresent(value) {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

export function deepEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (typeof left !== typeof right) return false;
  if (left === null || right === null) return false;
  if (typeof left !== "object") return false;

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, index) => deepEqual(item, right[index]));
  }

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => hasOwn(right, key) && deepEqual(left[key], right[key]));
}

export function evaluateCondition(condition, answers = {}, options = {}) {
  const triStateUnknown = options.triStateUnknown === true;

  if (hasOwn(condition, "always")) return condition.always === true;
  if (Array.isArray(condition.all)) {
    const results = condition.all.map((item) => evaluateCondition(item, answers, options));
    return results.includes(false) ? false : results.every((item) => item === true) ? true : triStateUnknown ? undefined : false;
  }
  if (Array.isArray(condition.any)) {
    const results = condition.any.map((item) => evaluateCondition(item, answers, options));
    return results.includes(true) ? true : results.every((item) => item === false) ? false : triStateUnknown ? undefined : false;
  }
  if (condition.not) {
    const result = evaluateCondition(condition.not, answers, options);
    return result === undefined ? undefined : !result;
  }

  if (hasOwn(condition, "exists")) return isAnswerPresent(answers[condition.answer]) === condition.exists;
  const hasAnswer = isAnswerPresent(answers[condition.answer]);
  if (!hasAnswer) return triStateUnknown ? undefined : false;
  const value = answers[condition.answer];

  if (hasOwn(condition, "equals")) return deepEqual(value, condition.equals);
  if (hasOwn(condition, "notEquals")) return !deepEqual(value, condition.notEquals);
  if (Array.isArray(condition.in)) return condition.in.some((item) => deepEqual(item, value));
  if (Array.isArray(condition.includesAny)) return Array.isArray(value) && condition.includesAny.some((item) => value.some((answer) => deepEqual(answer, item)));
  if (Array.isArray(condition.includesAll)) return Array.isArray(value) && condition.includesAll.every((item) => value.some((answer) => deepEqual(answer, item)));
  if (hasOwn(condition, "operator")) {
    if (typeof value !== "number") return false;
    return condition.operator === "lt" ? value < condition.value : condition.operator === "lte" ? value <= condition.value : condition.operator === "gt" ? value > condition.value : value >= condition.value;
  }
  return triStateUnknown ? undefined : false;
}

export function conditionCanMatch(condition, answers = {}, options = {}) {
  const result = evaluateCondition(condition, answers, { ...options, triStateUnknown: options.triStateUnknown === true });
  return result !== false;
}

export function resolveMatchingEdges(edges, answers = {}, options = {}) {
  return edges.filter((edge) => {
    const result = evaluateCondition(edge.condition, answers, options);
    return options.includeUnknown === true ? result !== false : result === true;
  });
}
