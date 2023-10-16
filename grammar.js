// TODO: support multiline js attributes: `input(name=JSON\n.stringify('test'))`, https://pugjs.org/language/attributes.html
//       completely lost on how to do this, but it's a feature of pug we should support eventually
// TODO: don't break if there are singular { or # in content
// TODO: support #[p(prop)] nested pug syntax
// TODO: remove all angular interpolation handling and replace with injections
//       will require using the parser for all tag content, which isn't ideal
//       requires that curly brackets are handled in content properly otherwise
//       `tag content {{interpolate}} content` will break because of { in the content
//       will have to support pug `tag #{}` too

// Taken from https://github.com/pugjs/pug/blob/master/packages/pug-lexer/index.js
const classNameRegex = /\.[_a-z0-9\-]*[_a-zA-Z][_a-zA-Z0-9\-]*/;
const idNameRegex = /#[\w-]+/;
const tagNameRegex = /\w([-\w]*\w)?/; // removed colon because it conflicts with other rules

const mixinAttrubuteRegex = /\w+/;
const filterNameRegex = /[\w\-]+/;
const htmlAttributeRegex = /#?[\w@\-:]+/;
const angularAttributeRegexString = "[\\w@\\-:\\.]+";

const whitespace = /( |\t)+/;

const anythingExceptNewlines = /[^\n]+/;
const anythingOrNothingExceptNewlines = /[^\n]*/;

const wordDelimiters = [
  "/",
  "'",
  '"',
  "<",
  "(",
  "[",
  "{",
  ".",
  ",",
  ":",
  ";",
  "!",
  "?",
  "\\",
  "}",
  "]",
  ")",
  ">",
  "#",
  " ",
  // Last so it doesn't get parsed as regex range
  "-",
];

module.exports = grammar({
  name: "pug",
  externals: ($) => [
    $._newline,
    $._indent,
    $._dedent,
    $._attr_js,
  ],
  rules: {
    source_file: ($) =>
      repeat(
        choice(
          $.conditional,
          $.comment,
          $.script_block,
          $.tag,
          $.doctype,
          $.unbuffered_code,
          $.buffered_code,
          $.unescaped_buffered_code,
          $.case,
          $.pipe,
          $.filter,
          $.block_definition,
          $.block_use,
          $.extends,
          $.mixin_definition,
          $.mixin_use,
          $.each,
          $.while,
          $.include
        )
      ),
    doctype: ($) =>
      seq("doctype", alias(choice("html", "strict", "xml"), $.doctype_name)),
    pipe: ($) => seq("|", optional($._content_or_javascript), $._newline),

    include: ($) =>
      prec.right(
        seq(
          alias("include", $.keyword),
          choice(
            optional($.filter),
            seq(whitespace, alias(anythingExceptNewlines, $.filename))
          )
        )
      ),

    while: ($) =>
      seq(
        alias("while", $.keyword),
        $.iteration_iterator,
        $._newline,
        $.children
      ),

    _each_js: ($) => alias($._attr_js, $.javascript),

    iteration_variable: ($) => seq($._each_js, optional(seq(",", $._each_js))),

    iteration_iterator: ($) => alias($._attr_js, $.javascript),

    _each_else: ($) => seq(alias("else", $.keyword), $._newline, $.children),

    each: ($) =>
      prec.right(
        seq(
          alias(choice("each", "for"), $.keyword),
          $.iteration_variable,
          alias("in", $.keyword),
          $.iteration_iterator,
          $._newline,
          $.children,
          alias(optional($._each_else), $.else)
        )
      ),

    mixin_use: ($) =>
      seq(
        "+",
        alias($.tag_name, $.mixin_name),
        optional(
          seq(
            "(",
            optional(
              seq(
                repeat(seq(alias($._attribute_value, $.attribute), ",")),
                alias($._attribute_value, $.attribute)
              )
            ),
            ")"
          )
        )
      ),
    mixin_definition: ($) =>
      seq(
        alias("mixin", $.keyword),
        alias($.tag_name, $.mixin_name),
        optional($.mixin_attributes),
        $._newline,
        $.children
      ),
    mixin_attributes: ($) =>
      seq(
        "(",
        optional(
          seq(
            repeat(seq(alias(mixinAttrubuteRegex, $.attribute_name), ",")),
            alias(mixinAttrubuteRegex, $.attribute_name)
          )
        ),
        ")"
      ),

    _block_content: ($) =>
      prec.left(
        seq(
          alias($.tag_name, $.block_name),
          optional(seq($._newline, $.children))
        )
      ),
    block_definition: ($) => seq(alias("block", $.keyword), $._block_content),
    block_use: ($) =>
      prec.right(
        choice(
          alias("block", $.keyword),
          seq(
            alias(optional("block"), $.keyword),
            alias(choice("append", "prepend"), $.keyword),
            $._block_content
          )
        )
      ),
    extends: ($) =>
      seq(
        alias("extends", $.keyword),
        alias(anythingExceptNewlines, $.filename) // The filename is the last thing on the line, so just match 'til the end
      ),

    filter: ($) =>
      prec.right(
        seq(
          ":",
          $.filter_name,
          optional($.attributes),
          optional(alias($.filter_content, $.content))
        )
      ),
    filter_name: () => filterNameRegex,
    filter_content: ($) =>
      choice(
        $.filter,
        seq(whitespace, anythingExceptNewlines),
        seq(
          $._newline,
          $._indent,
          repeat(seq(anythingOrNothingExceptNewlines, $._newline)),
          $._dedent
        )
      ),

    conditional: ($) =>
      seq(
        choice(
          seq(
            alias(choice("unless", "if", "else if"), $.keyword),
            whitespace,
            alias($._attr_js, $.javascript)
          ),
          alias("else", $.keyword)
        ),
        $._newline,
        $.children
      ),
    case: ($) =>
      prec.right(
        seq(
          alias("case", $.keyword),
          alias($._attr_js, $.javascript),
          $._newline,
          $._indent,
          repeat1($.when)
        )
      ),
    _when_content: ($) =>
      seq(
        choice(
          // Where the content is on the next line
          seq($._newline, $.children),
          // Where the content follows a : on the same line
          seq(":", alias($._dummy_tag, $.children))
        )
      ),
    _dummy_tag: ($) => $.tag,
    _when_statement: ($) =>
      choice(
        seq(
          alias("when", $.keyword),
          choice(alias($._attr_js, $.javascript), $.quoted_attribute_value)
        ),
        alias("default", $.keyword)
      ),
    when: ($) =>
      prec.left(
        seq(
          $._when_statement,
          choice(
            $._when_content,
            // There are newlines between each when case, but not the last when
            $._newline
          )
        )
      ),
    unescaped_buffered_code: ($) => seq("!=", $._single_line_buf_code),
    buffered_code: ($) => seq("=", $._single_line_buf_code),
    script_block: ($) =>
      seq(
        "script.",
        $._newline,
        $._indent,
        alias(
          repeat1(seq(optional(anythingExceptNewlines), $._newline)),
          $.javascript
        ),
        $._dedent
      ),
    _interpolatable_tag: ($) =>
      prec.left(
        seq(
          choice($.tag_name, $.id, $.class),
          optional(repeat1(choice($.id, $.class))),
          optional($.attributes),
          optional(alias("/", $.self_close_slash)),
          choice(
            seq(":", $.tag),
            $._content_after_dot,
            seq(
              optional(seq($._newline, $._indent)),
              choice($.buffered_code, $.unescaped_buffered_code)
            ),
            seq(
              choice(
                optional(whitespace),
                seq(whitespace, $._content_or_javascript)
              )
            )
          )
        )
      ),
    tag: ($) =>
      seq(
        choice($.tag_name, $.id, $.class),
        optional(repeat1(choice($.id, $.class))),
        optional($.attributes),
        optional(alias("/", $.self_close_slash)),
        choice(
          seq(":", $.tag),
          $._content_after_dot,
          seq(
            optional(seq($._newline, $._indent)),
            choice($.buffered_code, $.unescaped_buffered_code)
          ),
          seq(
            choice(
              optional(whitespace),
              seq(whitespace, $._content_or_javascript)
            ),
            $._newline,
            optional($.children)
          )
        )
      ),
    _content_after_dot: ($) =>
      seq(
        optional(seq($._newline, $._indent)),
        ".",
        $._newline,
        $._indent,
        alias(
          repeat1(seq(optional($._content_or_javascript), $._newline)),
          $.children
        ),
        $._dedent
      ),

    attributes: ($) =>
      seq(
        "(",
        repeat(prec.right(seq($.attribute, repeat(",")))),
        ")"
      ),
    attribute: ($) =>
      seq(
        $.attribute_name,
        optional(repeat1(seq(".", alias(/[\w@\-:]+/, $.attribute_modifier)))),
        optional(seq("=", $._attribute_value))
      ),
    _attribute_value: ($) =>
      choice($.quoted_attribute_value, alias($._attr_js, $.javascript)),
    quoted_attribute_value: ($) =>
      choice(
        seq("'", optional(alias(/(?:[^'\\]|\\.)+/, $.attribute_value)), "'"),
        seq('"', optional(alias(/(?:[^"\\]|\\.)+/, $.attribute_value)), '"'),
      ),
    children: ($) =>
      prec.right(
        seq(
          $._indent,
          repeat1($._children_choice),
          optional($._newline),
          $._dedent
        )
      ),
    _children_choice: ($) =>
      prec(
        1,
        choice(
          $.buffered_code,
          $.case,
          $.comment,
          $.conditional,
          $.doctype,
          $.pipe,
          $.script_block,
          $.tag,
          $.unbuffered_code,
          $.unescaped_buffered_code,
          $.filter,
          $.block_definition,
          $.block_use,
          $.extends,
          $.mixin_definition,
          $.mixin_use,
          $.each,
          $.while,
          $.include,
          $._newline
        )
      ),

    comment: ($) =>
      prec.left(
        seq(
          choice("//", "//-"),
          optional($._comment_content),
          $._newline,
          optional(
            seq(
              $._indent,
              repeat1(seq($._comment_content, $._newline)),
              $._dedent
            )
          )
        )
      ),

    tag_name: () => tagNameRegex,
    class: () => classNameRegex,
    id: () => idNameRegex,

    _angular_attribute_name: () =>
      choice(
        new RegExp("\\[" + angularAttributeRegexString + "\\]"), // [input]
        new RegExp("\\(" + angularAttributeRegexString + "\\)"), // (output)
        new RegExp("\\[\\(" + angularAttributeRegexString + "\\)\\]"), // [(both)]
        new RegExp("\\*" + angularAttributeRegexString) // *directive
      ),
    attribute_name: ($) =>
      choice(htmlAttributeRegex, $._angular_attribute_name),

    _interpolatable: ($) =>
      choice(
        alias($._interpolatable_tag, $.tag),
        $.unbuffered_code,
        $.buffered_code,
        $.unescaped_buffered_code,
        $.pipe,
        $.filter,
        $.mixin_use
      ),

    escaped_string_interpolation: ($) =>
      seq("#{", alias($._attr_js, $.interpolation_content), "}"),
    tag_interpolation: ($) =>
      seq("#[", alias($._interpolatable, $.interpolation_content), "]"),
    _comment_content: () => anythingOrNothingExceptNewlines,
    _delimited_javascript: () => /[^\n}]+/,
    _content_or_javascript: ($) =>
      prec.left(
        alias(
          repeat1(
            choice(
              $.escaped_string_interpolation,
              $.tag_interpolation,
              choice(...wordDelimiters),
              alias(regexNotMatching(wordDelimiters), "text")
            )
          ),
          $.content
        )
      ),

    _single_line_buf_code: ($) =>
      prec.left(
        seq(
          alias(anythingExceptNewlines, $.javascript),
          choice(
            seq(
              $._newline,
              $._indent,
              repeat1(choice($.tag, $._newline)),
              $._dedent
            ),
            $._newline
          )
        )
      ),
    unbuffered_code: ($) =>
      prec.right(
        seq(
          "-",
          optional(token.immediate(whitespace)),
          choice(
            seq($._single_line_buf_code),
            seq(
              $._newline,
              $._indent,
              seq(
                alias(
                  repeat1(seq(anythingExceptNewlines, $._newline)),
                  $.javascript
                ),
                $._dedent
              )
            )
          )
        )
      ),
  },
});

/**
 * Match any characters that aren't whitespace or that aren't in the given list.
 */
function regexNotMatching(characters) {
  characters = escapeRegExp(characters.join(""));
  return new RegExp(`[^\\s${characters}]+`);
}

/**
 * Escape regex characters
 * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions#escaping
 */
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // $& means the whole matched string
}
