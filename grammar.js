// TODO: support multiline js attributes: `input(name=JSON\n.stringify('test'))`, https://pugjs.org/language/attributes.html
// TODO: don't break if there are singular { or # in content
// TODO: support #[p(prop)] nested pug syntax
// TODO: support Angular's weird `let x as first; let y of items` template directive syntax.
//       documentation here: https://angular.io/guide/structural-directives#structural-directive-syntax-reference
//       Currently, it is just parsed as $.javascript, but this is not valid javascript, so parsing is broken,
//       but doesn't break any of the pug syntax tree.

// Taken from https://github.com/pugjs/pug/blob/master/packages/pug-lexer/index.js
const classNameRegex = /\.[_a-z0-9\-]*[_a-zA-Z][_a-zA-Z0-9\-]*/;
const idNameRegex = /#[\w-]+/;
const tagNameRegex = /\w([-\w]*\w)?/; // removed colon because it conflicts with other rules

const mixinAttrubuteRegex = /\w+/;
const filterNameRegex = /[\w\-]+/;
const htmlAttributeRegex = /#?[\w@\-:]+/;
const angularAttributeRegexString = '[\\w@\\-:\\.]+';

const whitespace = /\s+/;

const doubleQuoteStringContent = /((?:[^"\\]|\\.)*)/;
const singleQuoteStringContent = /((?:[^'\\]|\\.)*)/;
const templateQuoteStringContent = /((?:[^`\\]|\\.)*)/;

const anythingExceptNewlines = /[^\n]+/;
const anythingOrNothingExceptNewlines = /[^\n]*/;

module.exports = grammar({
  name: "pug",
  externals: ($) => [$._newline, $._indent, $._dedent, $._attr_js, $._attr_string],
  rules: {
    source_file: ($) => repeat(
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
        $.include,
      ),
    ),
    doctype: ($) =>
      seq("doctype", alias(choice("html", "strict", "xml"), $.doctype_name)),
    pipe: ($) =>
      seq("|", optional($._content_or_javascript), $._newline),

    include: ($) =>
      seq(
        alias('include', $.keyword),
        optional($.filter),
        alias(anythingExceptNewlines, $.filename),
      ),

    while: ($) =>
      seq(
        alias('while', $.keyword),
        $.iteration_iterator,
        $._newline,
        $.children,
      ),

    _each_js: ($) => alias($._attr_js, $.javascript),

    iteration_variable: ($) =>
      seq(
        $._each_js,
        optional(
          seq(
            ',',
            $._each_js,
          ),
        ),
      ),

    iteration_iterator: ($) => alias($._attr_js, $.javascript),

    _each_else: ($) =>
      seq(
        alias('else', $.keyword),
        $._newline,
        $.children,
      ),

    each: ($) =>
      prec.right(
        seq(
          alias(choice('each', 'for'), $.keyword),
          $.iteration_variable,
          alias('in', $.keyword),
          $.iteration_iterator,
          $._newline,
          $.children,
          alias(
            optional(
              $._each_else
            ),
            $.else
          ),
        ),
      ),

    mixin_use: ($) =>
      seq(
        '+',
        alias($.tag_name, $.mixin_name),
        optional(
          seq(
            '(',
            optional(
              seq(
                repeat(
                  seq(
                    alias($._attribute_value, $.attribute),
                    ',',
                  )
                ),
                alias($._attribute_value, $.attribute),
              )
            ),
            ')',
          ),
        ),
      ),
    mixin_definition: ($) =>
      seq(
        alias('mixin', $.keyword),
        alias($.tag_name, $.mixin_name),
        optional($.mixin_attributes),
        $._newline,
        $.children,
      ),
    mixin_attributes: ($) =>
      seq(
        '(',
        optional(
          seq(
            repeat(
              seq(
                alias(mixinAttrubuteRegex, $.attribute_name),
                ',',
              )
            ),
            alias(mixinAttrubuteRegex, $.attribute_name),
          )
        ),
        ')',
      ),

    _block_content: ($) =>
      prec.left(
        seq(
          alias($.tag_name, $.block_name),
          optional(
            seq(
              $._newline,
              $.children,
            )
          ),
        ),
      ),
    block_definition: ($) =>
      seq(
        alias('block', $.keyword),
        $._block_content,
      ),
    block_use: ($) =>
      seq(
        alias(optional('block'), $.keyword),
        alias(choice('append', 'prepend'), $.keyword),
        $._block_content,
      ),
    extends: ($) =>
      seq(
        alias('extends', $.keyword),
        alias(anythingExceptNewlines, $.filename), // The filename is the last thing on the line, so just match 'til the end
      ),

    filter: ($) =>
      prec.right(
        seq(
          ':',
          $.filter_name,
          optional($.attributes),
          optional(
            alias($.filter_content, $.content),
          ),
        ),
      ),
    filter_name: () => filterNameRegex,
    filter_content: ($) =>
      choice(
        $.filter,
        seq(
          whitespace,
          anythingExceptNewlines
        ),
        seq(
          $._newline,
          $._indent,
          repeat(
            seq(
              anythingOrNothingExceptNewlines,
              $._newline,
            ),
          ),
          $._dedent,
        )
      ),

    conditional: ($) =>
      seq(
        choice(
          seq(
            alias(
              choice(
                'unless',
                'if',
                'else if',
              ),
              $.keyword,
            ),
            alias($._attr_js, $.javascript),
          ),
          alias('else', $.keyword),
        ),
        $._newline,
        $.children,
      ),
    case: ($) =>
      prec.right(
        seq(
          alias('case', $.keyword),
          alias($._attr_js, $.javascript),
          $._newline,
          $._indent,
          repeat1(
            $.when,
          ),
        ),
      ),
    _when_content: ($) =>
      seq(
        choice(
          // Where the content is on the next line
          seq(
            $._newline,
            $.children,
          ),
          // Where the content follows a : on the same line
          seq(
            ':',
            alias($._dummy_tag, $.children),
          ),
        ),
      ),
    _dummy_tag: ($) => $.tag,
    _when_keyword: ($) =>
      choice(
        seq(
          alias('when', $.keyword),
          alias($._attr_js, $.javascript),
        ),
        alias('default', $.keyword),
      ),
    when: ($) =>
      prec.left(
        seq(
          $._when_keyword,
          choice(
            $._when_content,
            // There are newlines between each when case, but not the last when
            $._newline,
          ),
        ),
      ),
    unescaped_buffered_code: ($) =>
      seq(
        '!=',
        $._single_line_buf_code,
      ),
    buffered_code: ($) =>
      seq(
        '=',
        $._single_line_buf_code,
      ),
    script_block: ($) =>
      seq(
        'script.',
        $._newline,
        $._indent,
        alias(
          repeat1(
            seq(
              optional(anythingExceptNewlines),
              $._newline,
            )
          ),
          $.javascript
        ),
        $._dedent,
      ),
    tag: ($) =>
      seq(
        choice($.tag_name, $.id, $.class),
        optional(repeat1(choice($.id, $.class))),
        optional($.attributes),
        optional(alias('/', $.self_close_slash)),
        choice(
          seq(":", $.tag),
          $._content_after_dot,
          seq(
            optional(
              seq(
                $._newline,
                $._indent,
              ),
            ),
            choice($.buffered_code, $.unescaped_buffered_code),
          ),
          seq(
            optional(seq(" ", $._content_or_javascript)),
            $._newline,
            optional($.children)
          )
        )
      ),
    _content_after_dot: ($) =>
      seq(
        optional(
          seq(
            $._newline,
            $._indent,
          )
        ),
        ".",
        $._newline,
        $._indent,
        alias(
          repeat1(seq(optional($._content_or_javascript), $._newline)),
          $.children
        ),
        $._dedent,
      ),

    attributes: ($) =>
      seq(
        "(",
        repeat(
          prec.right(
            seq(
              $.attribute,
              optional(","),
            ),
          ),
        ),
        optional($.attribute),
        ")"
      ),
    attribute: ($) =>
      choice(
        $._attribute,
        $._angular_attribute,
      ),
    _attribute_value: ($) =>
      choice(
        alias($._attr_string, $.string),
        alias($._attr_js, $.javascript),
      ),
    _attribute: ($) =>
      seq(
        $.attribute_name,
        optional(repeat1(seq(".", alias(/[\w@\-:]+/, $.attribute_modifier)))),
        optional(
          seq(
            '=',
            $._attribute_value
          )
        ),
      ),
    _angular_attribute: ($) =>
      seq(
        alias($.angular_attribute_name, $.attribute_name),
        optional(
          seq(
            "=",
            alias($._attr_js, $.javascript),
          ),
        ),
      ),

        children: ($) => prec.right(
          seq(
            $._indent,
            repeat1($._children_choice),
            $._dedent,
          ),
        ),
        _children_choice: ($) =>
        prec(1,
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
            $.each,
            $.while,
            $.include,
            $._newline,
          ),
        ),

        comment: ($) =>
        choice(
          $._comment,
          $._comment_not_first_line,
        ),
        _comment: ($) =>
        prec.left(
          seq(
            choice("//", "//-"),
            $._comment_content,
            $._newline,
            optional(
              seq(
                $._indent,
                repeat1(
                  seq(
                    $._comment_content,
                    $._newline,
                  ),
                ),
                $._dedent,
              ),
            ),
          ),
        ),
        _comment_not_first_line: ($) =>
        seq(
          choice("//", "//-"),
          $._newline,
          $._indent,
          repeat1(
            seq(
              $._comment_content,
              $._newline,
            ),
          ),
          $._dedent,
        ),

        tag_name: () => tagNameRegex,
        class: () => classNameRegex,
        id: () => idNameRegex,

        angular_attribute_name: () =>
        choice(
          new RegExp('\\[' + angularAttributeRegexString + '\\]'), // [input]
          new RegExp('\\(' + angularAttributeRegexString + '\\)'), // (output)
          new RegExp('\\[\\(' + angularAttributeRegexString + '\\)\\]'), // [(both)]
          new RegExp('\\*' + angularAttributeRegexString), // *directive
        ),
        attribute_name: () => htmlAttributeRegex,

        content: () =>
        prec.right(
          repeat1(
            seq(
              /[^\n{#]+?/,
              optional('#'),
              optional('{')
            ),
          ),
        ),
        _comment_content: () => anythingOrNothingExceptNewlines,
        _delimited_javascript: () => /[^\n}]+/,
        _content_or_javascript: ($) =>
        repeat1(
          prec.right(
            choice(
              seq(
                "#{",
                alias($._delimited_javascript, $.javascript),
                "}"
              ),
              seq(
                "{{",
                alias($._delimited_javascript, $.javascript),
                "}}"
              ),
              $.content
            ),
          ),
        ),

        _single_line_buf_code: ($) =>
        prec.left(
          seq(
            alias(anythingExceptNewlines, $.javascript),
            choice(
              seq(
                $._newline,
                $._indent,
                repeat1(
                  choice(
                    $.tag,
                    $._newline,
                  ),
                ),
                $._dedent,
              ),
              $._newline,
            ),
          ),
        ),
        unbuffered_code: ($) =>
        prec.right(
          seq(
            '-',
            token.immediate(/( |\t)*/),
            choice(
              seq(
                $._single_line_buf_code,
              ),
              seq(
                $._newline,
                $._indent,
                seq(
                  alias(
                    repeat1(
                      seq(
                        anythingExceptNewlines,
                        $._newline,
                      ),
                    ),
                    $.javascript,
                  ),
                  $._dedent,
                )
              ),
            ),
          )
        )
  },
});
