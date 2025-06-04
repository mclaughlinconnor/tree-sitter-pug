import XCTest
import SwiftTreeSitter
import TreeSitterPug

final class TreeSitterPugTests: XCTestCase {
    func testCanLoadGrammar() throws {
        let parser = Parser()
        let language = Language(language: tree_sitter_pug())
        XCTAssertNoThrow(try parser.setLanguage(language),
                         "Error loading Pug grammar")
    }
}
