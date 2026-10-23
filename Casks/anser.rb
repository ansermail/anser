cask "anser" do
  arch arm: "aarch64", intel: "x86_64"

  version "0.1.26"
  sha256 arm:   "95a368af5e87b00d1c32575a34f67c1ab39d1682efda76669a77d2125712f73c",
         intel: "f32100be97735d3cbac46f227da1371417a48f17615e3102c820580fc447819f"

  url "https://github.com/ansermail/anser/releases/download/v#{version}/Anser_#{version}_#{arch}.dmg"
  name "Anser (雁信)"
  desc "Multi-account email client with local mail archiving"
  homepage "https://github.com/ansermail/anser"

  auto_updates true
  depends_on macos: :monterey

  app "雁信.app"
end
