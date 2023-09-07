#include "tree_sitter/parser.h"
#include <assert.h>
#include <ctype.h>
#include <stdio.h>
#include <string.h>

enum { TAB_WIDTH = 8 };

#define MAX(a, b) ((a) > (b) ? (a) : (b))

#define VEC_RESIZE(vec, _cap)                                                  \
  void *tmp = realloc((vec).data, (_cap) * sizeof((vec).data[0]));             \
  assert(tmp != NULL);                                                         \
  (vec).data = tmp;                                                            \
  (vec).cap = (_cap);

#define VEC_GROW(vec, _cap)                                                    \
  if ((vec).cap < (_cap)) {                                                    \
    VEC_RESIZE((vec), (_cap));                                                 \
  }

#define VEC_PUSH(vec, el)                                                      \
  if ((vec).cap == (vec).len) {                                                \
    VEC_RESIZE((vec), MAX(16, (vec).len * 2));                                 \
  }                                                                            \
  (vec).data[(vec).len++] = (el);

#define VEC_POP(vec) (vec).len--;

#define VEC_NEW                                                                \
  { .len = 0, .cap = 0, .data = NULL }

#define VEC_BACK(vec) ((vec).data[(vec).len - 1])

#define VEC_FREE(vec)                                                          \
  {                                                                            \
    if ((vec).data != NULL)                                                    \
      free((vec).data);                                                        \
  }

#define VEC_CLEAR(vec) (vec).len = 0;

enum TokenType {
  NEWLINE,
  INDENT,
  DEDENT,
  JS_ATTR,
  STRING,
};

typedef struct {
  uint32_t len;
  uint32_t cap;
  uint16_t *data;
} stack;

static stack stack_new() {
  stack vec = VEC_NEW;
  vec.data = calloc(1, sizeof(uint16_t));
  vec.cap = 1;
  return vec;
}

typedef struct {
  stack indents;
  stack parens;
  stack tern_qmark_depth;
  bool operator_pending;
} Scanner;

static inline void advance(TSLexer *lexer) { lexer->advance(lexer, false); }

static inline void skip(TSLexer *lexer) { lexer->advance(lexer, true); }

void serialize_stack(size_t *size, char *buffer, stack *stack) {
  buffer[(*size)++] = (char)stack->len;
  for (int iter = 1;
       iter < stack->len && *size < TREE_SITTER_SERIALIZATION_BUFFER_SIZE;
       ++iter) {
    buffer[(*size)++] = (char)stack->data[iter];
  }
}

unsigned tree_sitter_pug_external_scanner_serialize(void *payload,
                                                    char *buffer) {
  Scanner *scanner = (Scanner *)payload;
  size_t size = 0;

  serialize_stack(&size, buffer, &scanner->indents);
  serialize_stack(&size, buffer, &scanner->parens);
  serialize_stack(&size, buffer, &scanner->tern_qmark_depth);

  buffer[size++] = (char)scanner->operator_pending;

  return size;
}

void deserialize_stack(int *index, const char *buffer, stack *stack) {
  int stack_size = (unsigned char)buffer[*index];
  (*index)++;

  while (*index < stack_size) {
    VEC_PUSH(*stack, (unsigned char)buffer[*index]);
    (*index)++;
  }
}

void tree_sitter_pug_external_scanner_deserialize(void *payload,
                                                  const char *buffer,
                                                  unsigned length) {
  Scanner *scanner = (Scanner *)payload;
  VEC_CLEAR(scanner->indents);
  VEC_PUSH(scanner->indents, 0);

  VEC_CLEAR(scanner->parens);
  VEC_PUSH(scanner->parens, 0);

  VEC_CLEAR(scanner->tern_qmark_depth);
  VEC_PUSH(scanner->tern_qmark_depth, 0);

  if (length > 0) {
    int index = 0;
    deserialize_stack(&index, buffer, &scanner->indents);
    deserialize_stack(&index, buffer, &scanner->parens);
    deserialize_stack(&index, buffer, &scanner->tern_qmark_depth);

    scanner->operator_pending = buffer[index];

    return;
  }
}

void *tree_sitter_pug_external_scanner_create() {
  Scanner *scanner = calloc(1, sizeof(Scanner));

  scanner->indents = stack_new();
  scanner->parens = stack_new();
  scanner->tern_qmark_depth = stack_new();

  tree_sitter_pug_external_scanner_deserialize(scanner, NULL, 0);

  return scanner;
}

/**
 * Returns true if the quote character is actually a JavaScript template quote.
 */
bool is_template_quote(char c) { return c == '`'; }

/** Return true if a character is a quote, false otherwise */
bool is_quote(char c) {
  switch (c) {
  case '"':
  case '\'':
  case '`':
    return true;
  default:
    return false;
  }
}

/** Return true if a bracket is a opening one, false otherwise */
bool is_open_bracket(char bracket) {
  switch (bracket) {
  case '(':
  case '[':
  case '{':
    return true;
  default:
    return false;
  }
}

/** Return true if a bracket is a closing one, false otherwise */
bool is_close_bracket(char bracket) {
  switch (bracket) {
  case ')':
  case ']':
  case '}':
    return true;
  default:
    return false;
  }
}

/** Switch a bracket from opening to closing or from closing to opening */
char switch_bracket(char bracket) {
  switch (bracket) {
  case '"':
    return '"';
  case '(':
    return ')';
  case ')':
    return '(';
  case '[':
    return ']';
  case '\'':
    return '\'';
  case ']':
    return '[';
  case '{':
    return '}';
  case '}':
    return '{';
  }

  return '\0';
}

/** Operators that are allowed outside of any brackets (at the very root) */
bool is_root_operator(char c) {
  switch (c) {
  case '$':
  case '&':
  case '*':
  case '+':
  case '-':
  case '.':
  case '/':
  case ':':
  case ';':
  case '<':
  case '=':
  case '>':
  case '?':
  case '^':
  case '|':
  case '!':
    return true;
  default:
    return false;
  }
}

/** Operators that are allowed outside the root */
bool is_operator(char c) {
  if (is_root_operator(c)) {
    return true;
  }

  switch (c) {
  case ',':
    return true;
  default:
    return false;
  }
}

/**
 * We're in a string if the most recent paren is a quote and the
 * current character isn't a quote.
 */
bool is_in_string(char c, Scanner *scanner) {
  return is_quote(VEC_BACK(scanner->parens)) && !is_quote(c);
}

/**
 * We're in parens if the top of the parens stack has is not 0.
 */
bool is_in_parens(Scanner *scanner) { return VEC_BACK(scanner->parens) != 0; }

/**
 * A valid attribute has been found if lexer->result_symbol is
 * STRING or JS_ATTR.
 */
bool is_attr_found(TSLexer *lexer) {
  return lexer->result_symbol == JS_ATTR || lexer->result_symbol == STRING;
}

/** Simply advance the lexer and unmark operator pending */
void handle_alphanumeric(Scanner *scanner, TSLexer *lexer) {
  scanner->operator_pending = false;
  advance(lexer);
}

/**
 * If we're inside a string (i.e., the most recent paren is the same
 * as the current character), then the quote is a closing one, otherwise
 * it's an opening one.
 */
void handle_quote(Scanner *scanner, TSLexer *lexer) {
  if (VEC_BACK(scanner->parens) == lexer->lookahead) {
    VEC_POP(scanner->parens);
  } else {
    VEC_PUSH(scanner->parens, lexer->lookahead);
  }
  advance(lexer);
}

/** Opening parens unmark operator pending, then get pushed to the stack */
void handle_open_bracket(Scanner *scanner, TSLexer *lexer) {
  scanner->operator_pending = false;
  VEC_PUSH(scanner->parens, lexer->lookahead);
  advance(lexer);
}

/**
 * Handle opening bracket-style characters that appear in the text.
 *
 * Brackets must have different open and closing tags. When a bracket is found,
 * operator_pending mode is set false, then the bracket is considered valid if
 * the opening equivalent to the current character is the top element of the
 * scanner->parens stack. If a matching bracket is not found on top of the
 * stack, mark the end of the token, and return `false`.
 */
bool handle_close_backet(Scanner *scanner, TSLexer *lexer) {
  scanner->operator_pending = false;
  if (VEC_BACK(scanner->parens) == switch_bracket((char)lexer->lookahead)) {
    lexer->result_symbol = JS_ATTR;
    VEC_POP(scanner->parens);
    advance(lexer);
    return true; // isn't error
  }

  lexer->mark_end(lexer);
  return false; // is error
}

/**
 * If an operator character is found (e.g., '+' or '-'), then we have to look
 * for a second operand after it, so mark operator pending.
 */
void handle_operator(Scanner *scanner, TSLexer *lexer) {
  lexer->result_symbol = JS_ATTR;
  scanner->operator_pending = true;
  advance(lexer);
}

/**
 * Root operators are ones allowed outside of any parens. '?' and ':' require
 * handling because a ':' is valid in `tag(attr={a: 1})`, but not in
 * `tag(attr=a:1)`. If there was an "opening" question mark at the same paren
 * level as we've just found a colon, then we've got a valid ternary.
 */
bool handle_root_operator(Scanner *scanner, TSLexer *lexer) {
  char c = (char)lexer->lookahead;
  lexer->result_symbol = JS_ATTR;

  if (c == '?') {
    VEC_PUSH(scanner->tern_qmark_depth, scanner->parens.len)
  }

  if (c == ':') {
    if (VEC_BACK(scanner->tern_qmark_depth) != (scanner->parens).len) {
      lexer->mark_end(lexer);
      return true;
    }
    VEC_POP(scanner->tern_qmark_depth);
  }

  scanner->operator_pending = true;
  advance(lexer);

  return false;
}

/**
 * If the character following whitespace is not an operator and we're not
 * looking for an operator, then we've found some other term.
 */
bool is_intra_term_spacing(Scanner *scanner, TSLexer *lexer) {
  char c = (char)lexer->lookahead;
  return !is_operator(c) && !is_root_operator(c) && !scanner->operator_pending;
}

/**
 * Advance over all whitespace, then if the whitespace is between terms
 * (i.e., `tag(attr=1 + 2)`), then mark the end of the token and whether
 * a valid attribute was found
 */
bool handle_whitespace(Scanner *scanner, TSLexer *lexer) {
  lexer->mark_end(lexer);
  while ((lexer->lookahead == ' ' || lexer->lookahead == '\t')) {
    advance(lexer);
  }

  if (is_intra_term_spacing(scanner, lexer)) {
    lexer->mark_end(lexer);
    scanner->operator_pending = false;
    return is_attr_found(lexer) && !is_in_parens(scanner);
  }

  return false;
}

/**
 * A character is a valid string character if it's alphanumeric or
 * we're ina a quote
 */
bool is_valid_alpha(char c, Scanner *scanner) {
  return isalpha(c) || isdigit(c) || (is_in_string(c, scanner)) || c == '_';
}

bool handle_attr(Scanner *scanner, TSLexer *lexer, const bool *valid_symbols) {
  while ((lexer->lookahead == ' ' || lexer->lookahead == '\t')) {
    skip(lexer);
  }

  while (true) {
    if (lexer->eof(lexer)) {
      return is_attr_found(lexer);
    }

    char lookahead = (char)lexer->lookahead;

    if (lookahead == '\\' && is_in_string(lookahead, scanner)) {
      // Only set STRING if result isn't already set so we don't
      // overwrite JS_ATTR
      if (!lexer->result_symbol) {
        lexer->result_symbol = valid_symbols[STRING] ? STRING : JS_ATTR;
      }

      // Skip over \ and the next character
      advance(lexer);
      advance(lexer);
    } else if (is_valid_alpha(lookahead, scanner)) {
      // Alpha characters are valid inside STRING and JS_ATTR, so don't
      // overwrite them
      if (!lexer->result_symbol) {
        lexer->result_symbol = JS_ATTR;
      }
      handle_alphanumeric(scanner, lexer);
    } else if (is_quote(lookahead)) {
      if (!lexer->result_symbol) {
        lexer->result_symbol =
            (valid_symbols[STRING] && !is_template_quote(lookahead)) ? STRING
                                                                     : JS_ATTR;
      }

      handle_quote(scanner, lexer);
    } else if (is_open_bracket(lookahead)) {
      lexer->result_symbol = JS_ATTR;
      handle_open_bracket(scanner, lexer);
    } else if (is_close_bracket(lookahead)) {

      // returns true for success, false for there being errors
      if (handle_close_backet(scanner, lexer)) {
        lexer->result_symbol = JS_ATTR;
      } else {
        return is_attr_found(lexer);
      }

    } else if (is_operator(lookahead) && is_in_parens(scanner)) {
      lexer->result_symbol = JS_ATTR;
      handle_operator(scanner, lexer);
    } else if (is_root_operator(lookahead)) {
      // Will return true if we should stop
      if (handle_root_operator(scanner, lexer)) {
        return true;
      }
    } else if ((lexer->lookahead == ' ' || lexer->lookahead == '\t')) {
      // Will return true if we should stop
      if (handle_whitespace(scanner, lexer)) {
        return true;
      }
    } else {
      // The character found is not one we expected
      lexer->mark_end(lexer);
      return is_attr_found(lexer);
    }
  }
}

bool tree_sitter_pug_external_scanner_scan(void *payload, TSLexer *lexer,
                                           const bool *valid_symbols) {
  Scanner *scanner = (Scanner *)payload;

  if (lexer->lookahead == '\n') {
    if (valid_symbols[NEWLINE]) {
      skip(lexer);
      lexer->result_symbol = NEWLINE;
      return true;
    }
  }

  // If a token is expecting a DEDENT to end, it's still valid if we've
  // reached the end insetad.
  if (valid_symbols[DEDENT] && lexer->eof(lexer)) {
    lexer->result_symbol = DEDENT;
    return true;
  }

  if (lexer->lookahead) {
    uint32_t starting_column = lexer->get_column(lexer);
    uint32_t indent_length = 0;

    // Indent tokens are zero width
    lexer->mark_end(lexer);

    for (;;) {
      if (lexer->lookahead == ' ') {
        indent_length++;
        skip(lexer);
      } else if (lexer->lookahead == '\t') {
        indent_length += TAB_WIDTH;
        skip(lexer);
      } else {
        break;
      }
    }

    if (indent_length > VEC_BACK(scanner->indents) && valid_symbols[INDENT] &&
        starting_column == 0) {
      VEC_PUSH(scanner->indents, indent_length);
      lexer->result_symbol = INDENT;
      return true;
    }

    if (indent_length < VEC_BACK(scanner->indents) && valid_symbols[DEDENT]) {
      VEC_POP(scanner->indents);
      lexer->result_symbol = DEDENT;
      return true;
    }
  }

  if (valid_symbols[JS_ATTR] || valid_symbols[STRING]) {
    return handle_attr(scanner, lexer, valid_symbols);
  }

  // If a token is expecting a DEDENT to end, it's still valid if we've
  // reached the end insetad.
  if (valid_symbols[DEDENT] && lexer->eof(lexer)) {
    lexer->result_symbol = DEDENT;
    return true;
  }

  return false;
}

void tree_sitter_pug_external_scanner_destroy(void *payload) {
  Scanner *scanner = (Scanner *)payload;
  VEC_FREE(scanner->indents);
  VEC_FREE(scanner->parens);
  VEC_FREE(scanner->tern_qmark_depth);
  free(scanner);
}
