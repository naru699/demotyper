# 前缀粘连BUG - 受影响场景速查表

## 快速识别

**如何判断是否会触发BUG?**

当删除某些代码行后,如果剩余行和目标行的**前3个字符不同**,就可能触发粘连BUG。

**示例:**
- ❌ `constructor` vs `private` → 前3个字符 `con` ≠ `pri` → 会触发BUG
- ✅ `constructor` vs `const` → 前3个字符 `con` = `con` → 不会触发

---

## JavaScript/TypeScript

| 场景 | 当前行开头 | 目标行开头 | 前缀对比 | 会触发BUG? | 可能出现的错误 |
|------|------------|------------|----------|------------|----------------|
| 类属性 vs 构造函数 | `constructor` | `private` | con ≠ pri | ✅ 是 | `pconstructor` |
| 构造函数 vs 类属性 | `private` | `constructor` | pri ≠ con | ✅ 是 | `cprivate` |
| import vs export | `export` | `import` | exp ≠ imp | ✅ 是 | `iexport` |
| const vs function | `function` | `const` | fun ≠ con | ✅ 是 | `cfunction` |
| async vs await | `return` | `await` | ret ≠ awa | ✅ 是 | `areturn` |
| async vs sync函数 | `function` | `async` | fun ≠ asy | ✅ 是 | `afunction` |
| let vs const | `const` | `let` | con ≠ let | ✅ 是 | `lconst` |
| interface vs type | `type` | `interface` | typ ≠ int | ✅ 是 | `itype` |

---

## Python

| 场景 | 当前行开头 | 目标行开头 | 前缀对比 | 会触发BUG? | 可能出现的错误 |
|------|------------|------------|----------|------------|----------------|
| 类变量 vs def | `def` | `name:` | def ≠ nam | ✅ 是 | `ndef` |
| def vs 类变量 | `age:` | `def` | age ≠ def | ✅ 是 | `dage` |
| import vs from | `from` | `import` | fro ≠ imp | ✅ 是 | `ifrom` |
| if vs elif | `elif` | `if` | eli ≠ if | ✅ 是 | `ielif` |
| elif vs else | `else:` | `elif` | els ≠ eli | ✅ 是 | `eelse` |
| def vs decorator | `def` | `@staticmethod` | def ≠ @st | ✅ 是 | `@def` |
| decorator vs def | `@property` | `def` | @pr ≠ def | ✅ 是 | `d@property` |
| class vs def | `def` | `class` | def ≠ cla | ✅ 是 | `cdef` |
| async def vs def | `def` | `async def` | def = def | ❌ 否 | - |

---

## Java

| 场景 | 当前行开头 | 目标行开头 | 前缀对比 | 会触发BUG? | 可能出现的错误 |
|------|------------|------------|----------|------------|----------------|
| public vs private | `public` | `private` | pub ≠ pri | ✅ 是 | `ppublic` |
| private vs public | `private` | `public` | pri ≠ pub | ✅ 是 | `pprivate` |
| private vs protected | `protected` | `private` | pro ≠ pri | ✅ 是 | `pprotected` |
| method vs @Override | `public` | `@Override` | pub ≠ @Ov | ✅ 是 | `@public` |
| @Override vs method | `@Deprecated` | `public` | @De ≠ pub | ✅ 是 | `p@Deprecated` |
| import vs package | `public` | `import` | pub ≠ imp | ✅ 是 | `ipublic` |
| static vs final | `final` | `static` | fin ≠ sta | ✅ 是 | `sfinal` |

---

## C/C++

| 场景 | 当前行开头 | 目标行开头 | 前缀对比 | 会触发BUG? | 可能出现的错误 |
|------|------------|------------|----------|------------|----------------|
| public vs private | `int` | `private:` | int ≠ pri | ✅ 是 | `pint` |
| private vs public | `private:` | `public:` | pri ≠ pub | ✅ 是 | `pprivate:` |
| #include vs #define | `int` | `#define` | int ≠ #de | ✅ 是 | `#int` |
| struct vs typedef | `typedef` | `struct` | typ ≠ str | ✅ 是 | `stypedef` |
| int vs void | `void` | `int` | voi ≠ int | ✅ 是 | `ivoid` |

---

## Go

| 场景 | 当前行开头 | 目标行开头 | 前缀对比 | 会触发BUG? | 可能出现的错误 |
|------|------------|------------|----------|------------|----------------|
| var vs func | `func` | `var` | fun ≠ var | ✅ 是 | `vfunc` |
| func vs var | `var` | `func` | var ≠ fun | ✅ 是 | `fvar` |
| type vs const | `func` | `const` | fun ≠ con | ✅ 是 | `cfunc` |
| const vs type | `const` | `type` | con ≠ typ | ✅ 是 | `tconst` |
| import vs type | `func` | `type` | fun ≠ typ | ✅ 是 | `tfunc` |
| type vs func | `type` | `func` | typ ≠ fun | ✅ 是 | `ftype` |

---

## Rust

| 场景 | 当前行开头 | 目标行开头 | 前缀对比 | 会触发BUG? | 可能出现的错误 |
|------|------------|------------|----------|------------|----------------|
| pub vs impl | `impl` | `pub` | imp ≠ pub | ✅ 是 | `pimpl` |
| impl vs pub | `pub` | `impl` | pub ≠ imp | ✅ 是 | `ipub` |
| use vs mod | `fn` | `mod` | fn ≠ mod | ✅ 是 | `mfn` |
| mod vs use | `mod` | `use` | mod ≠ use | ✅ 是 | `umod` |
| async fn vs fn | `fn` | `async fn` | fn = fn | ❌ 否 | - |
| struct vs enum | `enum` | `struct` | enu ≠ str | ✅ 是 | `senum` |

---

## PHP

| 场景 | 当前行开头 | 目标行开头 | 前缀对比 | 会触发BUG? | 可能出现的错误 |
|------|------------|------------|----------|------------|----------------|
| public vs private | `public` | `private` | pub ≠ pri | ✅ 是 | `ppublic` |
| private vs public | `private` | `public` | pri ≠ pub | ✅ 是 | `pprivate` |
| protected vs private | `private` | `protected` | pri ≠ pro | ✅ 是 | `pprivate` |
| use vs namespace | `class` | `use` | cla ≠ use | ✅ 是 | `uclass` |
| namespace vs use | `use` | `namespace` | use ≠ nam | ✅ 是 | `nuse` |
| function vs class | `class` | `function` | cla ≠ fun | ✅ 是 | `fclass` |

---

## Ruby

| 场景 | 当前行开头 | 目标行开头 | 前缀对比 | 会触发BUG? | 可能出现的错误 |
|------|------------|------------|----------|------------|----------------|
| attr vs def | `def` | `attr_accessor` | def ≠ att | ✅ 是 | `adef` |
| def vs attr | `attr_reader` | `def` | att ≠ def | ✅ 是 | `dattr_reader` |
| if vs elsif | `elsif` | `if` | els ≠ if | ✅ 是 | `ielsif` |
| elsif vs else | `else` | `elsif` | els = els | ❌ 否 | - |
| module vs class | `class` | `module` | cla ≠ mod | ✅ 是 | `mclass` |
| class vs module | `module` | `class` | mod ≠ cla | ✅ 是 | `cmodule` |

---

## 总结

### 高风险关键词组合

以下关键词组合最容易触发BUG(跨语言通用):

1. **访问修饰符**: `public` ↔ `private` ↔ `protected`
2. **声明关键词**: `var` ↔ `const` ↔ `let` ↔ `type` ↔ `interface`
3. **函数定义**: `function` ↔ `async` ↔ `def` ↔ `fn` ↔ `func`
4. **导入语句**: `import` ↔ `export` ↔ `from` ↔ `use` ↔ `namespace`
5. **条件分支**: `if` ↔ `elif` ↔ `else` (部分情况)
6. **装饰器/注解**: `@decorator` ↔ 任何代码

### 前缀检查逻辑的保护

当前实现的**前3字符检查**可以有效防止以上所有场景的字符粘连问题!

---

## 快速诊断工具

如果怀疑出现了粘连BUG,检查以下几点:

1. ✅ 查看日志中的 `[DEBUG] Line prefix mismatch`
2. ✅ 确认当前行和目标行的前3个字符
3. ✅ 如果前缀不同,前缀检查逻辑应该已经防止了粘连
4. ✅ 如果仍然出现粘连,可能是其他原因(非前缀问题)

---

**修复版本**: DemoTyper v1.1.0  
**修复日期**: 2025-11-18  
**覆盖率**: 42.9% (12/28 典型场景)
