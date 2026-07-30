const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const CONTRACT_HASH_PATTERN = /^[0-9a-f]{64}$/u;

export const parseRequiredUuid = (value: string, label: string): string => {
  const trimmed = value.trim();

  if (!UUID_PATTERN.test(trimmed)) {
    throw new Error(`${label} must be a UUID.`);
  }

  return trimmed;
};

export const parseOptionalUuid = (
  value: string | undefined,
  label: string,
): string | undefined => {
  if (value === undefined) {
    return undefined;
  }

  return parseRequiredUuid(value, label);
};

export const parseRequiredContractHash = (value: string): string => {
  const trimmed = value.trim().toLowerCase();

  if (!CONTRACT_HASH_PATTERN.test(trimmed)) {
    throw new Error("--contract-hash must be a 64-character lowercase hex SHA-256.");
  }

  return trimmed;
};

export const rejectUnexpectedPositionals = (
  positionals: string[],
  command: string,
): void => {
  if (positionals.length === 0) {
    return;
  }

  throw new Error(
    `Unexpected positional arguments for ${command}: ${positionals.join(" ")}`,
  );
};

export const rejectUnexpectedSubcommand = (
  subcommand: string | undefined,
  command: string,
): void => {
  if (!subcommand) {
    return;
  }

  throw new Error(`Unexpected positional arguments for ${command}: ${subcommand}`);
};
