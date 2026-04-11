class KaiAi < Formula
  desc "AI coding assistant with persistent memory, background agents, and tool use"
  homepage "https://github.com/tmoreton/kai"
  url "https://registry.npmjs.org/kai-ai/-/kai-ai-1.1.3.tgz"
  sha256 "PLACEHOLDER_SHA256"
  license "Apache-2.0"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    system "#{bin}/kai", "--version"
  end
end
