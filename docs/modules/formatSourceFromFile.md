# Namespace: formatSourceFromFile

## Functions

### sync

▸ **sync**(`text`, `fileName`, `config`, `options?`): `undefined` \| `string`

Format given source text from a file, synchronoussly.

This function will try to find _tsconfig.json_ relating to the source file,
and merge them to the base config provided.

ESLint config will NOT be read because it's supported only by [formatSourceFromFile](formatSourceFromFile.md).

`options` can be used to change _tsconfig.json_ loading behavior for testing
purpose.

**`See`**

[formatSourceFromFile](formatSourceFromFile.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `text` | `string` | Source text |
| `fileName` | `string` | Source file name |
| `config` | [`Configuration`](../interfaces/Configuration.md) | Base config |
| `options?` | `FormatOptions` | Internal/testing options |

#### Returns

`undefined` \| `string`

The result text or `undefined` if nothing changes.

#### Defined in

[format/main/index.ts:74](https://github.com/daidodo/format-imports/blob/4f3f977/src/lib/format/main/index.ts#L74)
