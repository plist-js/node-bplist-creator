import { WritableStreamBuffer } from "nano-stream-buffers";

class Real {
  value: unknown;
  constructor(value: unknown) {
    this.value = value;
  }
}

type PlistJsObj = any[] | Record<any, any>;

type obj = NonNullable<unknown>;

function BPlistCreator(dicts: PlistJsObj): Buffer {
  const buffer = new WritableStreamBuffer();
  buffer.write(Buffer.from("bplist00"));

  if (Array.isArray(dicts) && dicts.length === 1) {
    dicts = dicts[0];
  }

  let entries = toEntries(dicts);

  const idSizeInBytes = computeIdSizeInBytes(entries.length);
  const offsets: number[] = [];
  let offsetSizeInBytes: number;
  let offsetTableOffset: number;

  updateEntryIds();

  entries.forEach(function (entry, entryIdx) {
    offsets[entryIdx] = buffer.size();
    if (!entry) {
      buffer.write(0x00);
    } else {
      write(entry);
    }
  });

  writeOffsetTable();
  writeTrailer();
  return buffer.getContents();

  function updateEntryIds() {
    const strings = {};
    let entryId = 0;
    entries.forEach(function (entry) {
      if (entry.id) {
        return;
      }
      if (entry.type === "string") {
        if (!entry.bplistOverride && strings.hasOwnProperty(entry.value)) {
          entry.type = "stringref";
          entry.id = strings[entry.value];
        } else {
          strings[entry.value] = entry.id = entryId++;
        }
      } else {
        entry.id = entryId++;
      }
    });

    entries = entries.filter(function (entry) {
      return entry.type !== "stringref";
    });
  }

  function writeTrailer() {
    // 6 null bytes
    buffer.write(Buffer.from([0, 0, 0, 0, 0, 0]));

    // size of an offset
    writeByte(offsetSizeInBytes);

    // size of a ref
    writeByte(idSizeInBytes);

    // number of objects
    writeLong(entries.length);

    // top object
    writeLong(0);

    // offset table offset
    writeLong(offsetTableOffset);
  }

  function writeOffsetTable() {
    offsetTableOffset = buffer.size();
    offsetSizeInBytes = computeOffsetSizeInBytes(offsetTableOffset);
    offsets.forEach(function (offset) {
      writeBytes(offset, offsetSizeInBytes);
    });
  }

  function write(entry) {
    switch (entry.type) {
      case "dict":
        writeDict(entry);
        break;
      case "number":
      case "double":
        writeNumber(entry);
        break;
      case "UID":
        writeUID(entry);
        break;
      case "array":
        writeArray(entry);
        break;
      case "boolean":
        writeBoolean(entry);
        break;
      case "string":
      case "string-utf16":
        writeString(entry);
        break;
      case "date":
        writeDate(entry);
        break;
      case "data":
        writeData(entry);
        break;
      default:
        throw new Error("unhandled entry type: " + entry.type);
    }
  }

  function writeDate(entry) {
    writeByte(0x33);
    const date = Date.parse(entry.value) / 1000 - 978307200;
    writeDouble(date);
  }

  function writeDict(entry) {
    writeIntHeader(0xd, entry.entryKeys.length);
    entry.entryKeys.forEach(function (entry) {
      writeID(entry.id);
    });
    entry.entryValues.forEach(function (entry) {
      writeID(entry.id);
    });
  }

  function writeNumber(entry) {
    if (typeof entry.value === "bigint") {
      const width = 16;
      const hex = entry.value.toString(width);
      const buf = Buffer.from(
        hex.padStart(width * 2, "0").slice(0, width * 2),
        "hex",
      );
      writeByte(0x14);
      buffer.write(buf);
    } else if (
      entry.type !== "double" &&
      parseFloat(entry.value).toFixed() == entry.value
    ) {
      if (entry.value < 0) {
        writeByte(0x13);
        writeBytes(entry.value, 8, true);
      } else if (entry.value <= 0xff) {
        writeByte(0x10);
        writeBytes(entry.value, 1);
      } else if (entry.value <= 0xffff) {
        writeByte(0x11);
        writeBytes(entry.value, 2);
      } else if (entry.value <= 0xffffffff) {
        writeByte(0x12);
        writeBytes(entry.value, 4);
      } else {
        writeByte(0x13);
        writeBytes(entry.value, 8);
      }
    } else {
      writeByte(0x23);
      writeDouble(entry.value);
    }
  }

  function writeUID(entry) {
    writeIntHeader(0x8, 0x0);
    writeID(entry.value);
  }

  function writeArray(entry) {
    writeIntHeader(0xa, entry.entries.length);
    entry.entries.forEach(function (e) {
      writeID(e.id);
    });
  }

  function writeBoolean(entry) {
    writeByte(entry.value ? 0x09 : 0x08);
  }

  function writeString(entry) {
    if (entry.type === "string-utf16" || mustBeUtf16(entry.value)) {
      const utf16 = Buffer.from(entry.value, "ucs2");
      writeIntHeader(0x6, utf16.length / 2);
      // needs to be big endian so swap the bytes
      for (let i = 0; i < utf16.length; i += 2) {
        const t = utf16[i + 0];
        utf16[i + 0] = utf16[i + 1];
        utf16[i + 1] = t;
      }
      buffer.write(utf16);
    } else {
      const utf8 = Buffer.from(entry.value, "ascii");
      writeIntHeader(0x5, utf8.length);
      buffer.write(utf8);
    }
  }

  function writeData(entry) {
    writeIntHeader(0x4, entry.value.length);
    buffer.write(entry.value);
  }

  function writeLong(l) {
    writeBytes(l, 8);
  }

  function writeByte(b) {
    buffer.write(Buffer.from([b]));
  }

  function writeDouble(v) {
    const buf = Buffer.alloc(8);
    buf.writeDoubleBE(v, 0);
    buffer.write(buf);
  }

  function writeIntHeader(kind, value) {
    if (value < 15) {
      writeByte((kind << 4) + value);
    } else if (value < 256) {
      writeByte((kind << 4) + 15);
      writeByte(0x10);
      writeBytes(value, 1);
    } else if (value < 65536) {
      writeByte((kind << 4) + 15);
      writeByte(0x11);
      writeBytes(value, 2);
    } else {
      writeByte((kind << 4) + 15);
      writeByte(0x12);
      writeBytes(value, 4);
    }
  }

  function writeID(id) {
    writeBytes(id, idSizeInBytes);
  }

  function writeBytes(value, bytes, is_signedint?: boolean) {
    // write low-order bytes big-endian style
    const buf = Buffer.alloc(bytes);
    let z = 0;

    // javascript doesn't handle large numbers
    while (bytes > 4) {
      buf[z++] = is_signedint ? 0xff : 0;
      bytes--;
    }

    for (let i = bytes - 1; i >= 0; i--) {
      buf[z++] = value >> (8 * i);
    }
    buffer.write(buf);
  }

  function mustBeUtf16(string) {
    return Buffer.byteLength(string, "utf8") != string.length;
  }
}

function toEntries(dicts: obj) {
  if (dicts.bplistOverride) {
    return [dicts];
  }

  if (Array.isArray(dicts)) {
    return toEntriesArray(dicts);
  } else if (dicts instanceof Buffer) {
    return [
      {
        type: "data",
        value: dicts,
      },
    ];
  } else if (dicts instanceof Real) {
    return [
      {
        type: "double",
        value: dicts.value,
      },
    ];
  } else if (typeof dicts === "object") {
    if (dicts instanceof Date) {
      return [
        {
          type: "date",
          value: dicts,
        },
      ];
    } else if (
      Object.keys(dicts).length == 1 &&
      typeof dicts.UID === "number"
    ) {
      return [
        {
          type: "UID",
          value: dicts.UID,
        },
      ];
    } else {
      return toEntriesObject(dicts);
    }
  } else if (typeof dicts === "string") {
    return [
      {
        type: "string",
        value: dicts,
      },
    ];
  } else if (typeof dicts === "number") {
    return [
      {
        type: "number",
        value: dicts,
      },
    ];
  } else if (typeof dicts === "boolean") {
    return [
      {
        type: "boolean",
        value: dicts,
      },
    ];
  } else if (typeof dicts === "bigint") {
    return [
      {
        type: "number",
        value: dicts,
      },
    ];
  } else {
    throw new Error("unhandled entry: " + dicts);
  }
}

function toEntriesArray(arr: obj[]) {
  let results = [
    {
      type: "array",
      entries: [],
    },
  ];
  arr.forEach(function (v) {
    const entry = toEntries(v);
    results[0].entries.push(entry[0]);
    results = results.concat(entry);
  });
  return results;
}

function toEntriesObject(dict) {
  let results = [
    {
      type: "dict",
      entryKeys: [],
      entryValues: [],
    },
  ];
  Object.keys(dict).forEach(function (key) {
    const entryKey = toEntries(key);
    results[0].entryKeys.push(entryKey[0]);
    results = results.concat(entryKey[0]);
  });
  Object.keys(dict).forEach(function (key) {
    const entryValue = toEntries(dict[key]);
    results[0].entryValues.push(entryValue[0]);
    results = results.concat(entryValue);
  });
  return results;
}

function computeOffsetSizeInBytes(maxOffset: number) {
  if (maxOffset < 256) {
    return 1;
  }
  if (maxOffset < 65536) {
    return 2;
  }
  if (maxOffset < 4294967296) {
    return 4;
  }
  return 8;
}

function computeIdSizeInBytes(numberOfIds: number) {
  if (numberOfIds < 256) {
    return 1;
  }
  if (numberOfIds < 65536) {
    return 2;
  }
  return 4;
}

export { BPlistCreator as default, BPlistCreator, Real };
